import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

/**
 * The operations queue.
 *
 * Most of what it shows is a PROJECTION of records the marketplace already
 * writes — KycSubmission, WithdrawalRequest, Report, JobDisputeMessage,
 * listings awaiting review. Those are read here and never created here: a
 * hand-made payout row would be a task with nothing behind it that somebody
 * could mark resolved without any money actually moving.
 *
 * OpsTask is the single exception, and it is labelled as such everywhere it
 * appears.
 */

export type OpsKind =
  | 'KYC'
  | 'WITHDRAWAL'
  | 'REPORT'
  | 'DISPUTE'
  | 'LISTING_REVIEW'
  | 'TASK';

/** Which Prisma model each queue reads from — surfaced so the wiring is obvious. */
export const OPS_KIND_SOURCE: Record<OpsKind, string> = {
  KYC: 'KycSubmission',
  WITHDRAWAL: 'WithdrawalRequest',
  REPORT: 'Report',
  DISPUTE: 'VendorJob',
  LISTING_REVIEW: 'Listing',
  TASK: 'OpsTask',
};

/** Kinds nobody may create by hand. */
export const DERIVED_OPS_KINDS: OpsKind[] = [
  'KYC',
  'WITHDRAWAL',
  'REPORT',
  'DISPUTE',
  'LISTING_REVIEW',
];

export interface OpsItem {
  id: string;
  kind: OpsKind;
  subject: string;
  amountNaira: number | null;
  openedAt: Date;
  assigneeId: string | null;
  resolved: boolean;
  urgent: boolean;
  /** False for everything read from another model. */
  editable: boolean;
  source: string;
}

@Injectable()
export class OpsQueueService {
  constructor(private readonly prisma: PrismaService) {}

  /** Everything open across every queue, derived and manual together. */
  async list(includeResolved = false): Promise<OpsItem[]> {
    const [kyc, withdrawals, reports, disputes, listings, tasks] =
      await Promise.all([
        this.prisma.kycSubmission.findMany({
          where: includeResolved ? {} : { status: 'PENDING' },
          select: {
            id: true,
            submittedAt: true,
            status: true,
            fullName: true,
            user: { select: { name: true } },
          },
          take: 200,
        }),
        this.prisma.withdrawalRequest.findMany({
          where: includeResolved ? {} : { status: 'PENDING' },
          select: {
            id: true,
            requestedAt: true,
            status: true,
            amountNaira: true,
            vendor: { select: { name: true } },
          },
          take: 200,
        }),
        this.prisma.report.findMany({
          where: includeResolved ? {} : { status: 'PENDING' },
          select: {
            id: true,
            createdAt: true,
            status: true,
            reason: true,
            targetType: true,
          },
          take: 200,
        }),
        this.prisma.vendorJob.findMany({
          where: { escrowStatus: 'DISPUTED' },
          select: {
            id: true,
            createdAt: true,
            title: true,
            escrowAmount: true,
          },
          take: 200,
        }),
        this.prisma.listing.findMany({
          where: { status: 'PENDING_REVIEW' },
          select: { id: true, createdAt: true, title: true },
          take: 200,
        }),
        this.prisma.opsTask.findMany({
          where: includeResolved ? {} : { resolved: false },
          select: {
            id: true,
            subject: true,
            urgent: true,
            resolved: true,
            assigneeId: true,
            openedAt: true,
          },
          take: 200,
        }),
      ]);

    const items: OpsItem[] = [
      ...kyc.map((k) => ({
        id: k.id,
        kind: 'KYC' as const,
        subject: `KYC review — ${k.fullName ?? k.user?.name ?? 'unknown user'}`,
        amountNaira: null,
        openedAt: k.submittedAt,
        assigneeId: null,
        resolved: k.status !== 'PENDING',
        urgent: false,
        editable: false,
        source: OPS_KIND_SOURCE.KYC,
      })),
      ...withdrawals.map((w) => ({
        id: w.id,
        kind: 'WITHDRAWAL' as const,
        subject: `Vendor payout — ${w.vendor?.name ?? 'unknown vendor'}`,
        amountNaira: w.amountNaira,
        openedAt: w.requestedAt,
        assigneeId: null,
        resolved: w.status !== 'PENDING',
        // Money that has not moved is always the most urgent thing here.
        urgent: true,
        editable: false,
        source: OPS_KIND_SOURCE.WITHDRAWAL,
      })),
      ...reports.map((r) => ({
        id: r.id,
        kind: 'REPORT' as const,
        subject: `Reported ${r.targetType.toLowerCase()} — ${r.reason}`,
        amountNaira: null,
        openedAt: r.createdAt,
        assigneeId: null,
        resolved: r.status !== 'PENDING',
        urgent: false,
        editable: false,
        source: OPS_KIND_SOURCE.REPORT,
      })),
      ...disputes.map((d) => ({
        id: d.id,
        kind: 'DISPUTE' as const,
        subject: `Escrow dispute — ${d.title}`,
        // What the buyer actually paid into escrow — the sum in dispute.
        amountNaira: d.escrowAmount,
        openedAt: d.createdAt,
        assigneeId: null,
        resolved: false,
        urgent: true,
        editable: false,
        source: OPS_KIND_SOURCE.DISPUTE,
      })),
      ...listings.map((l) => ({
        id: l.id,
        kind: 'LISTING_REVIEW' as const,
        subject: `Listing review — ${l.title}`,
        amountNaira: null,
        openedAt: l.createdAt,
        assigneeId: null,
        resolved: false,
        urgent: false,
        editable: false,
        source: OPS_KIND_SOURCE.LISTING_REVIEW,
      })),
      ...tasks.map((t) => ({
        id: t.id,
        kind: 'TASK' as const,
        subject: t.subject,
        amountNaira: null,
        openedAt: t.openedAt,
        assigneeId: t.assigneeId,
        resolved: t.resolved,
        urgent: t.urgent,
        editable: true,
        source: OPS_KIND_SOURCE.TASK,
      })),
    ];

    return items.sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime());
  }

  /** Counts for the dashboard, including money waiting on a human. */
  async summary() {
    const items = await this.list(false);
    const open = items.filter((i) => !i.resolved);
    return {
      open: open.length,
      unassigned: open.filter((i) => i.assigneeId === null).length,
      urgent: open.filter((i) => i.urgent).length,
      moneyAwaitingPayout: open
        .filter((i) => i.kind === 'WITHDRAWAL')
        .reduce((n, i) => n + (i.amountNaira ?? 0), 0),
      byKind: Object.fromEntries(
        (Object.keys(OPS_KIND_SOURCE) as OpsKind[]).map((k) => [
          k,
          open.filter((i) => i.kind === k).length,
        ]),
      ),
    };
  }

  /* ─── Manual tasks ───────────────────────────────────────────────────── */

  async createTask(dto: CreateTaskDto, createdById: string) {
    // Guard, not decoration. This is the only place an ops row can be born,
    // so the check lives here rather than relying on the client to behave.
    if (DERIVED_OPS_KINDS.includes(dto.kind as OpsKind)) {
      throw new BadRequestException(
        `${dto.kind} items are read from ${OPS_KIND_SOURCE[dto.kind as OpsKind]} and cannot be created by hand`,
      );
    }

    return this.prisma.opsTask.create({
      data: {
        subject: dto.subject,
        assigneeId: dto.assigneeId ?? null,
        urgent: dto.urgent ?? false,
        createdById,
      },
    });
  }

  async updateTask(id: string, dto: UpdateTaskDto) {
    const existing = await this.prisma.opsTask.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Task not found');

    return this.prisma.opsTask.update({
      where: { id },
      data: {
        subject: dto.subject,
        assigneeId: dto.assigneeId,
        urgent: dto.urgent,
        ...(dto.resolved !== undefined && {
          resolved: dto.resolved,
          resolvedAt: dto.resolved ? new Date() : null,
        }),
      },
    });
  }

  async removeTask(id: string) {
    const existing = await this.prisma.opsTask.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Task not found');
    await this.prisma.opsTask.delete({ where: { id } });
    return { deleted: true };
  }
}
