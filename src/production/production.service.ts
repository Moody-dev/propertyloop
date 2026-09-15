import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateShootDto } from './dto/create-shoot.dto';
import { UpdateShootDto } from './dto/update-shoot.dto';
import { CreateContentDto } from './dto/create-content.dto';
import { UpdateContentDto } from './dto/update-content.dto';
import {
  ListingOwnership,
  ListingStatus,
  Prisma,
  ShootStage,
} from '../../generated/prisma/client';
import { StaffAlertsService } from '../staff-alerts/staff-alerts.service';

const ONE_DAY_MS = 86_400_000;

const STAFF_BRIEF = {
  select: {
    id: true,
    letter: true,
    staffRole: true,
    user: { select: { id: true, name: true, avatarUrl: true } },
  },
} satisfies Prisma.StaffProfileDefaultArgs;

@Injectable()
export class ProductionService {
  constructor(
    private readonly prisma: PrismaService,
    // Optional so a unit test can build the service with Prisma alone.
    @Optional() private readonly alerts?: StaffAlertsService,
  ) {}

  /**
   * PropertyLoop stock a shoot can be for: id, title and where it is.
   *
   * Content staff do not hold MANAGE_PROPERTIES, so they cannot read the
   * property list the rest of the portal uses — without this their shoot form
   * had nothing to pick, and their shoot cards could not name the property.
   * Unpublished stock is included on purpose: a property is usually filmed
   * before it goes live, because the video is part of what publishing needs.
   */
  async listPropertyOptions() {
    return this.prisma.listing.findMany({
      where: {
        ownership: ListingOwnership.HOUSE,
        status: { not: ListingStatus.ARCHIVED },
      },
      select: { id: true, title: true, location: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  /* ─── Shoots ─────────────────────────────────────────────────────────── */

  async listShoots(stage?: ShootStage) {
    const shoots = await this.prisma.shoot.findMany({
      where: stage ? { stage } : undefined,
      include: {
        presenter: STAFF_BRIEF,
        secretary: STAFF_BRIEF,
        listing: { select: { id: true, title: true, location: true } },
      },
      orderBy: [{ scheduledFor: 'asc' }, { createdAt: 'desc' }],
    });

    return shoots.map((s) => ({
      ...s,
      // The Secretary's target is prep finished 24 hours ahead. Derived
      // rather than stored so it is always true of the current dates.
      prepLate: this.isPrepLate(s.scheduledFor, s.prepCompleteAt),
      prepOverdue:
        s.scheduledFor !== null &&
        s.prepCompleteAt === null &&
        s.scheduledFor.getTime() - Date.now() < ONE_DAY_MS,
    }));
  }

  private isPrepLate(
    scheduledFor: Date | null,
    prepCompleteAt: Date | null,
  ): boolean {
    // A shoot with no date booked cannot be late — it simply has not been
    // scheduled yet, which is a different problem.
    if (!scheduledFor) return false;
    if (!prepCompleteAt) return scheduledFor.getTime() < Date.now();
    return scheduledFor.getTime() - prepCompleteAt.getTime() < ONE_DAY_MS;
  }

  async createShoot(dto: CreateShootDto, actorStaffId?: string) {
    const shoot = await this.prisma.shoot.create({
      data: {
        title: dto.title,
        location: dto.location,
        listingId: dto.listingId ?? null,
        presenterId: dto.presenterId,
        secretaryId: dto.secretaryId,
        scheduledFor: dto.scheduledFor ?? null,
        // Nothing is booked until a date exists.
        stage: dto.scheduledFor ? ShootStage.SCHEDULED : ShootStage.REQUESTED,
      },
      include: { presenter: STAFF_BRIEF, secretary: STAFF_BRIEF },
    });
    this.alerts?.shootAssigned(
      shoot.title,
      [shoot.presenterId, shoot.secretaryId],
      actorStaffId,
      shoot.scheduledFor,
    );
    return shoot;
  }

  async updateShoot(id: string, dto: UpdateShootDto, actorStaffId?: string) {
    const existing = await this.prisma.shoot.findUnique({
      where: { id },
      select: { id: true, stage: true, presenterId: true, secretaryId: true },
    });
    if (!existing) throw new NotFoundException('Shoot not found');

    // Un-booking a shoot cannot leave it claiming to be scheduled. Only a
    // SCHEDULED shoot rewinds — one already filmed keeps its stage.
    const clearingDate = dto.scheduledFor === null;
    const stage =
      clearingDate && existing.stage === ShootStage.SCHEDULED
        ? ShootStage.REQUESTED
        : undefined;

    const shoot = await this.prisma.shoot.update({
      where: { id },
      data: {
        title: dto.title,
        location: dto.location,
        listingId: dto.listingId,
        presenterId: dto.presenterId,
        secretaryId: dto.secretaryId,
        scheduledFor: dto.scheduledFor,
        reshoot: dto.reshoot,
        engagementRate: dto.engagementRate,
        ...(stage && { stage }),
      },
      include: { presenter: STAFF_BRIEF, secretary: STAFF_BRIEF },
    });
    // Only whoever was newly put on the shoot.
    const newlyOn = [
      shoot.presenterId !== existing.presenterId ? shoot.presenterId : null,
      shoot.secretaryId !== existing.secretaryId ? shoot.secretaryId : null,
    ];
    if (newlyOn.some(Boolean)) {
      this.alerts?.shootAssigned(
        shoot.title,
        newlyOn,
        actorStaffId,
        shoot.scheduledFor,
      );
    }
    return shoot;
  }

  async setShootStage(id: string, stage: ShootStage) {
    const existing = await this.prisma.shoot.findUnique({
      where: { id },
      select: { publishedAt: true },
    });
    if (!existing) throw new NotFoundException('Shoot not found');

    return this.prisma.shoot.update({
      where: { id },
      data: {
        stage,
        ...(stage === ShootStage.PUBLISHED &&
          !existing.publishedAt && { publishedAt: new Date() }),
      },
      include: { presenter: STAFF_BRIEF, secretary: STAFF_BRIEF },
    });
  }

  async markPrepped(id: string) {
    const existing = await this.prisma.shoot.findUnique({
      where: { id },
      select: { stage: true },
    });
    if (!existing) throw new NotFoundException('Shoot not found');

    return this.prisma.shoot.update({
      where: { id },
      data: {
        prepCompleteAt: new Date(),
        ...(existing.stage === ShootStage.SCHEDULED && {
          stage: ShootStage.PREPPED,
        }),
      },
      include: { presenter: STAFF_BRIEF, secretary: STAFF_BRIEF },
    });
  }

  async removeShoot(id: string) {
    const existing = await this.prisma.shoot.findUnique({
      where: { id },
      select: { _count: { select: { conversations: true } } },
    });
    if (!existing) throw new NotFoundException('Shoot not found');
    await this.prisma.shoot.delete({ where: { id } });
    return { deleted: true, threadsRemoved: existing._count.conversations };
  }

  /* ─── Content ────────────────────────────────────────────────────────── */

  async listContent() {
    return this.prisma.contentPiece.findMany({
      include: { owner: STAFF_BRIEF },
      orderBy: [{ publishedAt: 'desc' }, { scheduledFor: 'asc' }],
    });
  }

  async createContent(dto: CreateContentDto) {
    return this.prisma.contentPiece.create({
      data: {
        title: dto.title,
        channel: dto.channel,
        kind: dto.kind,
        ownerId: dto.ownerId,
        scheduledFor: dto.scheduledFor ?? null,
        // No date means it is going out now.
        publishedAt: dto.scheduledFor ? null : new Date(),
      },
      include: { owner: STAFF_BRIEF },
    });
  }

  async updateContent(id: string, dto: UpdateContentDto) {
    const existing = await this.prisma.contentPiece.findUnique({
      where: { id },
      select: { publishedAt: true },
    });
    if (!existing) throw new NotFoundException('Content piece not found');

    return this.prisma.contentPiece.update({
      where: { id },
      data: {
        title: dto.title,
        channel: dto.channel,
        kind: dto.kind,
        ownerId: dto.ownerId,
        // Null clears it back to "not read yet", which is more honest than a
        // zero nobody has checked.
        engagementRate: dto.engagementRate,
        leadsGenerated: dto.leadsGenerated,
        ...(dto.publishNow && {
          publishedAt: existing.publishedAt ?? new Date(),
          scheduledFor: null,
        }),
        ...(!dto.publishNow &&
          dto.scheduledFor !== undefined && { scheduledFor: dto.scheduledFor }),
      },
      include: { owner: STAFF_BRIEF },
    });
  }

  async removeContent(id: string) {
    const existing = await this.prisma.contentPiece.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Content piece not found');
    await this.prisma.contentPiece.delete({ where: { id } });
    return { deleted: true };
  }
}
