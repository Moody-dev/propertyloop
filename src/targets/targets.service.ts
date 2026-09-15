import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { CurrentStaffData } from '../staff/decorators/current-staff.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTargetDto } from './dto/create-target.dto';
import { UpdateTargetDto } from './dto/update-target.dto';
import {
  DealStage,
  StaffTarget,
  TargetProvenance,
  StaffRole,
} from '../../generated/prisma/client';
import { StaffAlertsService } from '../staff-alerts/staff-alerts.service';

/** YYYY-MM for the current month, Lagos time. */
export function currentPeriod(at: Date = new Date()): string {
  const shifted = new Date(at.getTime() + 60 * 60_000);
  return shifted.toISOString().slice(0, 7);
}

function periodBounds(period: string): { from: Date; to: Date } {
  const [y, m] = period.split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1));
  from.setUTCMinutes(from.getUTCMinutes() - 60);
  const to = new Date(Date.UTC(y, m, 1));
  to.setUTCMinutes(to.getUTCMinutes() - 60);
  return { from, to };
}

/**
 * Derivations for DATABASE-backed targets.
 *
 * A target whose actual comes from one of these is a fact — nobody can type
 * it. Anything not listed here has to be entered by hand, which is what
 * TargetProvenance.MANUAL means and why the UI shows the difference.
 */
export const METRIC_KEYS = [
  'verifiedListings',
  'publishedListings',
  'newDeals',
  'mandatesSigned',
  'exclusiveMandates',
  'qualifiedLeads',
  'convertedLeads',
  'videosPublished',
  'contentPublished',
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];

@Injectable()
export class TargetsService {
  constructor(
    private readonly prisma: PrismaService,
    // Optional so a unit test can build the service with Prisma alone.
    @Optional() private readonly alerts?: StaffAlertsService,
  ) {}

  /**
   * Whether someone may set targets for a given person.
   *
   * The MD and GM run the whole scorecard. Anyone else holding
   * MANAGE_TARGETS — the Operations Manager — sets them only for the people
   * who report to them. The permission is for running a team, not for
   * rewriting the number a colleague in another department is measured on.
   */
  private async assertMayManageFor(actor: CurrentStaffData, staffId: string) {
    if (managesAllTargets(actor)) return;
    const person = await this.prisma.staffProfile.findUnique({
      where: { id: staffId },
      select: { reportsToId: true },
    });
    if (!person) throw new NotFoundException('Staff member not found');
    if (person.reportsToId !== actor.id) {
      throw new ForbiddenException(
        'You can only set targets for people who report to you',
      );
    }
  }

  async list(period?: string) {
    const p = period ?? currentPeriod();
    const targets = await this.prisma.staffTarget.findMany({
      where: { period: p },
      include: {
        staff: {
          select: {
            id: true,
            letter: true,
            staffRole: true,
            chapter: true,
            active: true,
            user: { select: { id: true, name: true, avatarUrl: true } },
          },
        },
      },
      orderBy: [{ staffId: 'asc' }, { label: 'asc' }],
    });

    return Promise.all(targets.map((t) => this.withActual(t, p)));
  }

  async listForStaff(staffId: string, period?: string) {
    const p = period ?? currentPeriod();
    const targets = await this.prisma.staffTarget.findMany({
      where: { staffId, period: p },
      orderBy: { label: 'asc' },
    });
    return Promise.all(targets.map((t) => this.withActual(t, p)));
  }

  /**
   * Attaches the real figure and the progress it implies.
   *
   * DATABASE targets are recomputed on every read, so the stored `actual`
   * column is ignored for them entirely — it cannot drift.
   */
  private async withActual<T extends StaffTarget>(target: T, period: string) {
    const actual =
      target.provenance === TargetProvenance.DATABASE && target.metricKey
        ? await this.computeMetric(
            target.metricKey as MetricKey,
            target.staffId,
            period,
          )
        : target.actual;

    return {
      ...target,
      actual,
      progress: this.progress(target, actual),
      met: this.progress(target, actual) >= 100,
    };
  }

  /**
   * Progress against the lower bound, capped at 100.
   *
   * A ceiling target is met by staying at or UNDER its number, so anything
   * within it is 100% rather than a fraction of it — scoring a reshoot rate
   * of 8% against a 10% limit as "20%" would read as failure when it is
   * success.
   */
  private progress(target: StaffTarget, actual: number): number {
    if (target.ceiling) {
      if (target.max === 0) return actual === 0 ? 100 : 0;
      if (actual <= target.max) return 100;
      const overshoot = (actual - target.max) / target.max;
      return Math.max(0, Math.round((1 - overshoot) * 100));
    }
    if (target.min === 0) return 100;
    return Math.min(100, Math.round((actual / target.min) * 100));
  }

  private async computeMetric(
    key: MetricKey,
    staffId: string,
    period: string,
  ): Promise<number> {
    const { from, to } = periodBounds(period);
    const window = { gte: from, lt: to };

    switch (key) {
      case 'verifiedListings':
        return this.prisma.listing.count({
          where: {
            sourcedByStaffId: staffId,
            verified: true,
            createdAt: window,
          },
        });
      case 'publishedListings':
        return this.prisma.listing.count({
          where: {
            sourcedByStaffId: staffId,
            status: 'ACTIVE',
            createdAt: window,
          },
        });
      case 'newDeals':
        return this.prisma.deal.count({
          where: { ownerId: staffId, createdAt: window },
        });
      case 'mandatesSigned':
        return this.prisma.deal.count({
          where: { ownerId: staffId, mandateSignedAt: window },
        });
      case 'exclusiveMandates':
        return this.prisma.deal.count({
          where: {
            ownerId: staffId,
            mandate: 'EXCLUSIVE',
            mandateSignedAt: window,
          },
        });
      case 'qualifiedLeads':
        return this.prisma.lead.count({
          where: {
            agent: { staffProfile: { id: staffId } },
            createdAt: window,
            status: { notIn: ['NEW', 'LOST'] },
          },
        });
      case 'convertedLeads':
        return this.prisma.lead.count({
          where: {
            agent: { staffProfile: { id: staffId } },
            status: 'CONVERTED',
            updatedAt: window,
          },
        });
      case 'videosPublished':
        return this.prisma.shoot.count({
          where: { presenterId: staffId, publishedAt: window },
        });
      case 'contentPublished':
        return this.prisma.contentPiece.count({
          where: { ownerId: staffId, publishedAt: window },
        });
      default:
        return 0;
    }
  }

  async create(actor: CurrentStaffData, dto: CreateTargetDto) {
    await this.assertMayManageFor(actor, dto.staffId);
    const target = await this.prisma.staffTarget.create({
      data: {
        staffId: dto.staffId,
        label: dto.label,
        min: dto.min,
        max: Math.max(dto.min, dto.max ?? dto.min),
        unit: dto.unit,
        ceiling: dto.ceiling ?? false,
        period: dto.period ?? currentPeriod(),
        // A target invented by hand has no query behind it. Saying so is the
        // entire point of the provenance column.
        provenance: dto.metricKey
          ? TargetProvenance.DATABASE
          : TargetProvenance.MANUAL,
        metricKey: dto.metricKey ?? null,
      },
    });
    this.alerts?.targetSet(dto.label, dto.staffId, actor.id);
    return target;
  }

  async update(actor: CurrentStaffData, id: string, dto: UpdateTargetDto) {
    const existing = await this.prisma.staffTarget.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Target not found');
    await this.assertMayManageFor(actor, existing.staffId);

    return this.prisma.staffTarget.update({
      where: { id },
      data: {
        label: dto.label,
        min: dto.min,
        ...(dto.max !== undefined && {
          max: Math.max(dto.min ?? existing.min, dto.max),
        }),
        // Ignored for DATABASE targets, which recompute on read — accepting
        // it silently would suggest a typed number could override a query.
        ...(existing.provenance === TargetProvenance.MANUAL &&
          dto.actual !== undefined && { actual: dto.actual }),
        unit: dto.unit,
        ceiling: dto.ceiling,
      },
    });
  }

  async remove(actor: CurrentStaffData, id: string) {
    const existing = await this.prisma.staffTarget.findUnique({
      where: { id },
      select: { id: true, staffId: true },
    });
    if (!existing) throw new NotFoundException('Target not found');
    await this.assertMayManageFor(actor, existing.staffId);
    await this.prisma.staffTarget.delete({ where: { id } });
    return { deleted: true };
  }

  /**
   * Copy a month's targets into the next one.
   *
   * Without this, every month starts with an empty scorecard and somebody
   * retypes twenty rows — which is how targets quietly stop being set.
   */
  async rollForward(
    actor: CurrentStaffData,
    fromPeriod: string,
    toPeriod: string,
  ) {
    // Copies every person's targets, so it belongs to whoever runs the
    // whole scorecard.
    if (!managesAllTargets(actor)) {
      throw new ForbiddenException(
        "Only the MD or GM can copy the whole team's targets into a new month",
      );
    }
    const source = await this.prisma.staffTarget.findMany({
      where: { period: fromPeriod },
    });
    if (source.length === 0) {
      throw new NotFoundException(`No targets found for ${fromPeriod}`);
    }

    const created = await this.prisma.staffTarget.createMany({
      data: source.map((t) => ({
        staffId: t.staffId,
        label: t.label,
        min: t.min,
        max: t.max,
        // Actuals never carry over — that would be last month's result
        // presented as this month's progress.
        actual: 0,
        unit: t.unit,
        ceiling: t.ceiling,
        provenance: t.provenance,
        metricKey: t.metricKey,
        period: toPeriod,
      })),
      skipDuplicates: true,
    });

    return { copied: created.count, from: fromPeriod, to: toPeriod };
  }

  /** Company-wide snapshot for the dashboard. */
  async snapshot(period?: string) {
    const p = period ?? currentPeriod();
    const { from, to } = periodBounds(p);
    const window = { gte: from, lt: to };

    const [
      publishedListings,
      pendingListings,
      openDeals,
      exclusiveMandates,
      dealsWon,
      convertedLeads,
      videosPublished,
    ] = await Promise.all([
      this.prisma.listing.count({ where: { status: 'ACTIVE' } }),
      this.prisma.listing.count({ where: { status: 'PENDING_REVIEW' } }),
      this.prisma.deal.count({
        where: { stage: { notIn: [DealStage.LOST, DealStage.PUBLISHED] } },
      }),
      this.prisma.deal.count({
        where: { mandate: 'EXCLUSIVE', mandateSignedAt: window },
      }),
      this.prisma.deal.count({ where: { mandateSignedAt: window } }),
      this.prisma.lead.count({
        where: { status: 'CONVERTED', updatedAt: window },
      }),
      this.prisma.shoot.count({ where: { publishedAt: window } }),
    ]);

    return {
      period: p,
      publishedListings,
      pendingListings,
      openDeals,
      exclusiveMandates,
      dealsWon,
      convertedLeads,
      videosPublished,
    };
  }
}

/** The MD and GM set anyone's targets; other managers only their reports'. */
export function managesAllTargets(staff: Pick<CurrentStaffData, 'staffRole'>) {
  return (
    staff.staffRole === StaffRole.MD_CEO || staff.staffRole === StaffRole.GM
  );
}
