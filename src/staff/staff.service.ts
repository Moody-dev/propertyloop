import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_STAFF_PERMISSIONS } from './staff-permissions';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
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

  async update(id: string, dto: UpdateStaffDto) {
    await this.findOne(id);

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
