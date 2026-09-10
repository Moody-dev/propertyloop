import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDealDto } from './dto/create-deal.dto';
import { UpdateDealDto } from './dto/update-deal.dto';
import { ListDealsDto } from './dto/list-deals.dto';
import { DealStage, MandateType, Prisma } from '../../generated/prisma/client';

/** No activity in this many days marks a deal stale. */
const STALE_AFTER_DAYS = 7;

const DEAL_SELECT = {
  id: true,
  company: true,
  contactName: true,
  contactPhone: true,
  kind: true,
  stage: true,
  mandate: true,
  valueNaira: true,
  expectedUnits: true,
  chapter: true,
  mandateSignedAt: true,
  nextAction: true,
  nextActionAt: true,
  notes: true,
  lastActivityAt: true,
  createdAt: true,
  ownerId: true,
  owner: {
    select: {
      id: true,
      letter: true,
      staffRole: true,
      user: { select: { id: true, name: true, avatarUrl: true } },
    },
  },
  _count: { select: { listings: true } },
} satisfies Prisma.DealSelect;

@Injectable()
export class DealsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * valueNaira is BigInt in the database (a Banana Island mandate overflows
   * int4). main.ts teaches JSON.stringify to serialise BigInt, but converting
   * here too keeps the shape explicit for anything that reads the service
   * directly rather than through HTTP.
   */
  private serialize<T extends { valueNaira: bigint }>(deal: T) {
    return { ...deal, valueNaira: Number(deal.valueNaira) };
  }

  async list(dto: ListDealsDto) {
    const where: Prisma.DealWhereInput = {
      ...(dto.stage && { stage: dto.stage }),
      ...(dto.kind && { kind: dto.kind }),
      ...(dto.chapter && { chapter: dto.chapter }),
      ...(dto.ownerId && { ownerId: dto.ownerId }),
      ...(dto.search && {
        OR: [
          { company: { contains: dto.search, mode: 'insensitive' } },
          { contactName: { contains: dto.search, mode: 'insensitive' } },
        ],
      }),
    };

    const deals = await this.prisma.deal.findMany({
      where,
      select: DEAL_SELECT,
      orderBy: { lastActivityAt: 'desc' },
    });

    const staleBefore = new Date(Date.now() - STALE_AFTER_DAYS * 86_400_000);
    const now = new Date();

    return deals.map((d) => ({
      ...this.serialize(d),
      // Derived rather than stored: a stored flag would need a cron to stay
      // true, and would be wrong between runs.
      stale: d.stage !== DealStage.LOST && d.lastActivityAt < staleBefore,
      actionOverdue:
        d.stage !== DealStage.LOST &&
        d.nextActionAt !== null &&
        d.nextActionAt < now,
    }));
  }

  async findOne(id: string) {
    const deal = await this.prisma.deal.findUnique({
      where: { id },
      select: {
        ...DEAL_SELECT,
        listings: {
          select: { id: true, title: true, status: true, verified: true },
        },
      },
    });
    if (!deal) throw new NotFoundException('Deal not found');
    return this.serialize(deal);
  }

  async create(dto: CreateDealDto) {
    const deal = await this.prisma.deal.create({
      data: {
        company: dto.company,
        contactName: dto.contactName,
        contactPhone: dto.contactPhone ?? null,
        kind: dto.kind,
        mandate: dto.mandate ?? MandateType.NONE,
        valueNaira: BigInt(dto.valueNaira ?? 0),
        expectedUnits: dto.expectedUnits ?? 0,
        ownerId: dto.ownerId,
        chapter: dto.chapter,
        nextAction: dto.nextAction ?? null,
        nextActionAt: dto.nextActionAt ?? null,
        notes: dto.notes ?? '',
        // A deal signed at creation still needs its date, or "mandates this
        // month" would miss it.
        mandateSignedAt:
          dto.mandate && dto.mandate !== MandateType.NONE ? new Date() : null,
      },
      select: DEAL_SELECT,
    });
    return this.serialize(deal);
  }

  async update(id: string, dto: UpdateDealDto) {
    const existing = await this.prisma.deal.findUnique({
      where: { id },
      select: { id: true, mandate: true, mandateSignedAt: true },
    });
    if (!existing) throw new NotFoundException('Deal not found');

    const gainingMandate =
      dto.mandate !== undefined &&
      dto.mandate !== MandateType.NONE &&
      existing.mandate === MandateType.NONE;

    const deal = await this.prisma.deal.update({
      where: { id },
      data: {
        company: dto.company,
        contactName: dto.contactName,
        contactPhone: dto.contactPhone,
        kind: dto.kind,
        mandate: dto.mandate,
        ...(dto.valueNaira !== undefined && {
          valueNaira: BigInt(dto.valueNaira),
        }),
        expectedUnits: dto.expectedUnits,
        ownerId: dto.ownerId,
        chapter: dto.chapter,
        nextAction: dto.nextAction,
        nextActionAt: dto.nextActionAt,
        notes: dto.notes,
        ...(gainingMandate && { mandateSignedAt: new Date() }),
        // Editing a deal IS activity, so it stops reading as stale.
        lastActivityAt: new Date(),
      },
      select: DEAL_SELECT,
    });
    return this.serialize(deal);
  }

  /** Move along the board. Kept separate so a drag is one small call. */
  async setStage(id: string, stage: DealStage) {
    const existing = await this.prisma.deal.findUnique({
      where: { id },
      select: { id: true, mandate: true, mandateSignedAt: true },
    });
    if (!existing) throw new NotFoundException('Deal not found');

    // Reaching MANDATE_SIGNED with no mandate type recorded is the most
    // common data gap — default it rather than leave the pipeline reporting
    // an exclusive nobody signed.
    const mandate =
      stage === DealStage.MANDATE_SIGNED &&
      existing.mandate === MandateType.NONE
        ? MandateType.OPEN
        : existing.mandate;

    const deal = await this.prisma.deal.update({
      where: { id },
      data: {
        stage,
        mandate,
        lastActivityAt: new Date(),
        ...(stage === DealStage.MANDATE_SIGNED &&
          !existing.mandateSignedAt && { mandateSignedAt: new Date() }),
      },
      select: DEAL_SELECT,
    });
    return this.serialize(deal);
  }

  /**
   * Deleting clears the link from any listing that came through this deal,
   * and cascades the threads pinned to it (the schema handles both). Without
   * the first, a property would point at a mandate that no longer exists.
   */
  async remove(id: string) {
    const deal = await this.prisma.deal.findUnique({
      where: { id },
      select: { id: true, _count: { select: { listings: true } } },
    });
    if (!deal) throw new NotFoundException('Deal not found');

    await this.prisma.deal.delete({ where: { id } });
    return { deleted: true, listingsUnlinked: deal._count.listings };
  }

  /** What a delete would touch, so the client can say so before asking. */
  async deleteImpact(id: string) {
    const deal = await this.prisma.deal.findUnique({
      where: { id },
      select: {
        _count: { select: { listings: true, conversations: true } },
      },
    });
    if (!deal) throw new NotFoundException('Deal not found');
    return {
      listingsUnlinked: deal._count.listings,
      threadsRemoved: deal._count.conversations,
    };
  }
}
