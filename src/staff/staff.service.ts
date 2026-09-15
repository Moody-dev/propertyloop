import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_STAFF_PERMISSIONS } from './staff-permissions';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { ProvisionStaffDto } from './dto/provision-staff.dto';
import { accountRole, generatePassword } from './staff-accounts';
import { Prisma } from '../../generated/prisma/client';

const STAFF_SELECT = {
  id: true,
  userId: true,
  letter: true,
  staffRole: true,
  chapter: true,
  secondaryChapter: true,
  permissions: true,
  reportsToId: true,
  active: true,
  createdAt: true,
  user: {
    select: { id: true, name: true, email: true, avatarUrl: true, phone: true },
  },
} satisfies Prisma.StaffProfileSelect;

@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService) {}

  /** Everyone, including deactivated positions — the Team screen shows both. */
  async list() {
    return this.prisma.staffProfile.findMany({
      select: STAFF_SELECT,
      orderBy: [{ chapter: 'asc' }, { letter: 'asc' }],
    });
  }

  async findOne(id: string) {
    const staff = await this.prisma.staffProfile.findUnique({
      where: { id },
      select: STAFF_SELECT,
    });
    if (!staff) throw new NotFoundException('Staff member not found');
    return staff;
  }

  /** The signed-in user's own profile, or null if they are not staff. */
  async me(userId: string) {
    return this.prisma.staffProfile.findUnique({
      where: { userId },
      select: STAFF_SELECT,
    });
  }

  async create(dto: CreateStaffDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      select: { id: true, deletedAt: true },
    });
    if (!user || user.deletedAt) {
      throw new NotFoundException('User not found');
    }

    const existing = await this.prisma.staffProfile.findUnique({
      where: { userId: dto.userId },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException('This user already has a staff profile');
    }

    return this.prisma.staffProfile.create({
      // Permissions default from the position but are stored explicitly, so
      // changing the defaults later never silently re-grants anyone.
      data: {
        userId: dto.userId,
        letter: dto.letter.toUpperCase(),
        staffRole: dto.staffRole,
        chapter: dto.chapter,
        secondaryChapter: dto.secondaryChapter ?? null,
        reportsToId: dto.reportsToId ?? null,
        permissions:
          dto.permissions ?? DEFAULT_STAFF_PERMISSIONS[dto.staffRole],
      },
      select: STAFF_SELECT,
    });
  }

  /**
   * Create the account and the position together, from the portal.
   *
   * The temporary password is returned exactly once and never stored in
   * readable form — the database keeps only the hash. Whoever adds the person
   * must hand it over privately; there is no way to show it again.
   */
  async provision(dto: ProvisionStaffDto) {
    const email = dto.email.trim().toLowerCase();
    const taken = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (taken) {
      throw new ConflictException('An account with that email already exists');
    }

    const temporaryPassword = generatePassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);

    // One transaction: a login with no position, or a position with no login,
    // is a half-made person nobody can fix from the portal.
    const staff = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          name: dto.name.trim(),
          role: accountRole(dto.staffRole),
          // Staff are onboarded in person; there is nothing for an email
          // verification round-trip to prove.
          emailVerifiedAt: new Date(),
          signupPlatform: 'web',
        },
        select: { id: true },
      });
      return tx.staffProfile.create({
        data: {
          userId: user.id,
          letter: dto.letter.toUpperCase(),
          staffRole: dto.staffRole,
          chapter: dto.chapter,
          secondaryChapter: dto.secondaryChapter ?? null,
          reportsToId: dto.reportsToId ?? null,
          permissions: DEFAULT_STAFF_PERMISSIONS[dto.staffRole],
        },
        select: STAFF_SELECT,
      });
    });

    return { staff, temporaryPassword };
  }

  /**
   * Issue a new temporary password for someone who cannot sign in.
   *
   * Like provision, the password is returned once and only its hash is kept.
   * Every existing session is ended too: if the reason for the reset is a
   * password that leaked, a device still signed in with it must not stay in.
   */
  async resetPassword(id: string) {
    const staff = await this.findOne(id);

    const temporaryPassword = generatePassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);
    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: staff.userId },
        data: { passwordHash },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: staff.userId, revokedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.session.updateMany({
        where: { userId: staff.userId, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);

    return { staff, temporaryPassword };
  }

  async update(id: string, dto: UpdateStaffDto) {
    const current = await this.findOne(id);

    // Name and email live on the account, not the position.
    if (dto.name !== undefined || dto.email !== undefined) {
      const email = dto.email?.trim().toLowerCase();
      if (email) {
        const holder = await this.prisma.user.findUnique({
          where: { email },
          select: { id: true },
        });
        if (holder && holder.id !== current.userId) {
          throw new ConflictException(
            'Another account already uses that email',
          );
        }
      }
      await this.prisma.user.update({
        where: { id: current.userId },
        data: { name: dto.name?.trim(), email },
      });
    }

    if (dto.reportsToId === id) {
      throw new BadRequestException(
        'A staff member cannot report to themselves',
      );
    }
    if (dto.reportsToId) {
      await this.assertNoReportingCycle(id, dto.reportsToId);
    }

    return this.prisma.staffProfile.update({
      where: { id },
      data: {
        letter: dto.letter?.toUpperCase(),
        staffRole: dto.staffRole,
        chapter: dto.chapter,
        secondaryChapter: dto.secondaryChapter,
        reportsToId: dto.reportsToId,
        permissions: dto.permissions,
      },
      select: STAFF_SELECT,
    });
  }

  /**
   * Deactivate or reactivate. There is no delete: a staff id is stamped on
   * every listing, deal, lead, log and message the person touched, so
   * removing the row would orphan all of it.
   */
  async setActive(id: string, active: boolean) {
    await this.findOne(id);
    return this.prisma.staffProfile.update({
      where: { id },
      data: { active },
      select: STAFF_SELECT,
    });
  }

  /** Reset one profile back to the defaults for its position. */
  async resetPermissions(id: string) {
    const staff = await this.findOne(id);
    return this.prisma.staffProfile.update({
      where: { id },
      data: { permissions: DEFAULT_STAFF_PERMISSIONS[staff.staffRole] },
      select: STAFF_SELECT,
    });
  }

  /**
   * Walking up from the proposed manager must never arrive back at this
   * person. Without this, A→B→A would make the org chart infinite and hang
   * anything that renders it.
   */
  private async assertNoReportingCycle(staffId: string, managerId: string) {
    const seen = new Set<string>([staffId]);
    let cursor: string | null = managerId;

    while (cursor) {
      if (seen.has(cursor)) {
        throw new BadRequestException(
          'That reporting line would create a loop',
        );
      }
      seen.add(cursor);
      const next = await this.prisma.staffProfile.findUnique({
        where: { id: cursor },
        select: { reportsToId: true },
      });
      cursor = next?.reportsToId ?? null;
    }
  }
}
