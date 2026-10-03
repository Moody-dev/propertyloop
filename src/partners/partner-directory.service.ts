import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  LeadStatus,
  ListingOwnership,
  PartnerCommissionStatus,
  PartnerStatus,
  Prisma,
} from '../../generated/prisma/client';
import { partnerPayoutGaps, partnerPayoutReady } from './partners.service';
import { StaffAlertsService } from '../staff-alerts/staff-alerts.service';

/** Operations' onboarding commitment for a new realtor, in hours. */
export const PARTNER_CONTACT_SLA_HOURS = 48;

/**
 * Staff-side management of the partner directory.
 *
 * Separated from PartnersService because the audiences are different: that
 * one serves partners, this one serves the team portal, and they need
 * different permission gates around the same tables.
 */
@Injectable()
export class PartnerDirectoryService {
  constructor(
    private readonly prisma: PrismaService,
    // Optional so a unit test can build the service with Prisma alone.
    @Optional() private readonly alerts?: StaffAlertsService,
  ) {}

  async list(options: {
    page: number;
    limit: number;
    status?: PartnerStatus;
    ownerStaffId?: string;
    search?: string;
    /** Only those stuck: past the contact SLA, or unable to be paid. */
    stuckOnly?: boolean;
  }) {
    const { page, limit, status, ownerStaffId, search, stuckOnly } = options;

    const where: Prisma.AgentPartnerWhereInput = {
      ...(status && { status }),
      ...(ownerStaffId === 'UNASSIGNED'
        ? { ownerStaffId: null }
        : ownerStaffId && { ownerStaffId }),
      ...(search && {
        OR: [
          { code: { contains: search, mode: 'insensitive' } },
          { agencyName: { contains: search, mode: 'insensitive' } },
          { user: { name: { contains: search, mode: 'insensitive' } } },
          { user: { email: { contains: search, mode: 'insensitive' } } },
          { user: { phone: { contains: search } } },
        ],
      }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.agentPartner.findMany({
        where,
        orderBy: { registeredAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: { select: { id: true, name: true, email: true, phone: true } },
          referredBy: { select: { code: true } },
          ownerStaff: {
            select: { id: true, user: { select: { name: true } } },
          },
          _count: { select: { referrals: true, leads: true } },
        },
      }),
      this.prisma.agentPartner.count({ where }),
    ]);

    const now = new Date();
    const items = rows
      .map((p) => ({
        id: p.id,
        code: p.code,
        name: p.user.name,
        email: p.user.email,
        phone: p.user.phone,
        status: p.status,
        experience: p.experience,
        agencyName: p.agencyName,
        operatingState: p.operatingState,
        referredByCode: p.referredBy?.code ?? null,
        owner: p.ownerStaff
          ? { id: p.ownerStaff.id, name: p.ownerStaff.user.name }
          : null,
        payoutReady: partnerPayoutReady(p),
        payoutGaps: partnerPayoutGaps(p),
        registeredAt: p.registeredAt,
        lastContactAt: p.lastContactAt,
        contactOverdue: this.contactOverdue(p, now),
        referredCount: p._count.referrals,
        introductions: p._count.leads,
        notes: p.notes,
      }))
      .filter((p) =>
        stuckOnly
          ? p.contactOverdue ||
            (!p.payoutReady &&
              (p.status === PartnerStatus.VERIFIED ||
                p.status === PartnerStatus.ACTIVE))
          : true,
      );

    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  private contactOverdue(
    p: {
      lastContactAt: Date | null;
      registeredAt: Date;
      status: PartnerStatus;
    },
    now: Date,
  ): boolean {
    if (p.lastContactAt) return false;
    // Chasing somebody we already declined would be noise.
    if (
      p.status === PartnerStatus.REJECTED ||
      p.status === PartnerStatus.DORMANT
    ) {
      return false;
    }
    return (
      now.getTime() - p.registeredAt.getTime() >
      PARTNER_CONTACT_SLA_HOURS * 3_600_000
    );
  }

  /** The numbers a manager needs: who was never called, who cannot be paid. */
  async summary() {
    const all = await this.prisma.agentPartner.findMany({
      select: {
        status: true,
        registeredAt: true,
        lastContactAt: true,
        ownerStaffId: true,
        referredById: true,
        passportPhotoUrl: true,
        bankCode: true,
        accountNumber: true,
        nin: true,
        tin: true,
        payerId: true,
      },
    });

    const now = new Date();
    const week = now.getTime() - 7 * 86_400_000;
    const live = all.filter(
      (p) =>
        p.status !== PartnerStatus.REJECTED &&
        p.status !== PartnerStatus.DORMANT,
    );
    const ready = (p: (typeof all)[number]) =>
      Boolean(
        p.passportPhotoUrl &&
        p.bankCode &&
        p.accountNumber &&
        p.nin &&
        (p.payerId || p.tin),
      );

    const pendingCommission = await this.prisma.partnerCommission.aggregate({
      where: { status: PartnerCommissionStatus.PENDING },
      _sum: { amountNaira: true },
      _count: true,
    });

    return {
      total: all.length,
      registeredThisWeek: all.filter((p) => p.registeredAt.getTime() > week)
        .length,
      uncontacted: live.filter((p) => p.lastContactAt === null).length,
      overdueContact: all.filter((p) => this.contactOverdue(p, now)).length,
      unassigned: live.filter((p) => p.ownerStaffId === null).length,
      verified: all.filter((p) => p.status === PartnerStatus.VERIFIED).length,
      active: all.filter((p) => p.status === PartnerStatus.ACTIVE).length,
      fromReferral: all.filter((p) => p.referredById !== null).length,
      cannotBePaid: all.filter(
        (p) =>
          (p.status === PartnerStatus.VERIFIED ||
            p.status === PartnerStatus.ACTIVE) &&
          !ready(p),
      ).length,
      commissionsPending: pendingCommission._count,
      commissionsPendingNaira: Number(pendingCommission._sum.amountNaira ?? 0n),
      contactSlaHours: PARTNER_CONTACT_SLA_HOURS,
    };
  }

  async setStatus(id: string, status: PartnerStatus) {
    const partner = await this.prisma.agentPartner.findUnique({
      where: { id },
      select: { id: true, lastContactAt: true, userId: true },
    });
    if (!partner) throw new NotFoundException('Partner not found');

    const updated = await this.prisma.agentPartner.update({
      where: { id },
      data: {
        status,
        // Moving somebody past NEW means a person spoke to them, so the
        // contact clock stops here rather than needing a second action.
        ...(status !== PartnerStatus.NEW &&
          !partner.lastContactAt && { lastContactAt: new Date() }),
      },
    });

    // VERIFIED is the gate for the public directory. An unvetted stranger
    // with a PropertyLoop agent profile is the reputational risk this whole
    // programme has to avoid, so the flag moves with the status rather than
    // being a second thing somebody remembers to do.
    await this.prisma.agentProfile.updateMany({
      where: { userId: partner.userId },
      data: {
        verified:
          status === PartnerStatus.VERIFIED || status === PartnerStatus.ACTIVE,
      },
    });

    return updated;
  }

  async assign(id: string, staffId: string | null, actorStaffId?: string) {
    await this.ensureExists(id);
    const partner = await this.prisma.agentPartner.update({
      where: { id },
      data: { ownerStaffId: staffId },
    });
    if (staffId) this.alerts?.partnerAssigned(id, staffId, actorStaffId);
    return partner;
  }

  async logContact(id: string) {
    const partner = await this.ensureExists(id);
    return this.prisma.agentPartner.update({
      where: { id },
      data: {
        lastContactAt: new Date(),
        ...(partner.status === PartnerStatus.NEW && {
          status: PartnerStatus.CONTACTED,
        }),
      },
    });
  }

  async setNotes(id: string, notes: string) {
    await this.ensureExists(id);
    return this.prisma.agentPartner.update({
      where: { id },
      data: { notes },
    });
  }

  private async ensureExists(id: string) {
    const partner = await this.prisma.agentPartner.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!partner) throw new NotFoundException('Partner not found');
    return partner;
  }

  /* ─── Commissions ────────────────────────────────────────────────── */

  /**
   * Record what a partner is owed for an introduction that closed.
   *
   * Recording is separate from approving, and gated on a different
   * permission: the person who logs a sale should not be the one who
   * releases the money for it.
   */
  async recordCommission(input: {
    leadId: string;
    saleValueNaira: number;
    /** Agreed on the sale. There is no default to fall back on. */
    ratePercent: number;
    note?: string;
  }) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: input.leadId },
      select: {
        id: true,
        listingId: true,
        status: true,
        broughtByPartnerId: true,
        listing: { select: { ownership: true } },
      },
    });
    if (!lead) throw new NotFoundException('Lead not found');
    if (!lead.broughtByPartnerId) {
      throw new BadRequestException(
        'That lead was not introduced by a partner, so no commission is owed',
      );
    }
    if (lead.listing?.ownership !== ListingOwnership.HOUSE) {
      throw new BadRequestException(
        'Partner commission applies to house inventory only',
      );
    }
    if (lead.status !== LeadStatus.CONVERTED) {
      throw new BadRequestException(
        'Mark the lead converted before recording its commission',
      );
    }

    const existing = await this.prisma.partnerCommission.findFirst({
      where: { leadId: lead.id },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException(
        'A commission has already been recorded for this introduction',
      );
    }

    // Required, not defaulted: commission is agreed per property, so a
    // fallback rate would pay whatever the code guessed rather than what was
    // actually agreed on this sale.
    const rate = input.ratePercent;
    if (rate === undefined || rate === null) {
      throw new BadRequestException(
        'Commission rate is required — it is agreed per property, so there is no default',
      );
    }
    if (rate <= 0 || rate > 100) {
      throw new BadRequestException(
        'Commission rate must be between 0 and 100',
      );
    }
    if (input.saleValueNaira <= 0) {
      throw new BadRequestException('Sale value must be positive');
    }

    const amount = BigInt(Math.round((input.saleValueNaira * rate) / 100));

    return this.prisma.partnerCommission.create({
      data: {
        partnerId: lead.broughtByPartnerId,
        listingId: lead.listingId,
        leadId: lead.id,
        saleValueNaira: BigInt(Math.round(input.saleValueNaira)),
        ratePercent: rate,
        amountNaira: amount,
        note: input.note?.trim() ?? '',
      },
    });
  }

  async listCommissions(status?: PartnerCommissionStatus) {
    const rows = await this.prisma.partnerCommission.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        partner: {
          select: { code: true, user: { select: { name: true } } },
        },
        listing: { select: { title: true } },
      },
    });

    return rows.map((c) => ({
      id: c.id,
      partnerCode: c.partner.code,
      partnerName: c.partner.user.name,
      listing: c.listing?.title ?? null,
      saleValueNaira: Number(c.saleValueNaira),
      ratePercent: c.ratePercent,
      amountNaira: Number(c.amountNaira),
      status: c.status,
      createdAt: c.createdAt,
      approvedAt: c.approvedAt,
      paidAt: c.paidAt,
      note: c.note,
    }));
  }

  /** Sign off a commission. Requires APPROVE_COMMISSION, not MANAGE_PARTNERS. */
  async decideCommission(
    id: string,
    staffId: string,
    decision: 'APPROVED' | 'REJECTED',
    note?: string,
  ) {
    const commission = await this.prisma.partnerCommission.findUnique({
      where: { id },
      select: { id: true, status: true, partnerId: true },
    });
    if (!commission) throw new NotFoundException('Commission not found');
    if (commission.status !== PartnerCommissionStatus.PENDING) {
      throw new BadRequestException(
        `This commission is already ${commission.status.toLowerCase()}`,
      );
    }

    if (decision === 'APPROVED') {
      // Approving something we cannot then transfer just moves the problem
      // to the payment run, where it is somebody else's confusing failure.
      const partner = await this.prisma.agentPartner.findUnique({
        where: { id: commission.partnerId },
      });
      if (partner && !partnerPayoutReady(partner)) {
        throw new BadRequestException(
          `Cannot approve — this partner still owes: ${partnerPayoutGaps(partner).join(', ')}`,
        );
      }
    }

    return this.prisma.partnerCommission.update({
      where: { id },
      data: {
        status:
          decision === 'APPROVED'
            ? PartnerCommissionStatus.APPROVED
            : PartnerCommissionStatus.REJECTED,
        approvedByStaffId: staffId,
        approvedAt: new Date(),
        ...(note && { note: note.trim() }),
      },
    });
  }

  async markPaid(id: string) {
    const commission = await this.prisma.partnerCommission.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!commission) throw new NotFoundException('Commission not found');
    if (commission.status !== PartnerCommissionStatus.APPROVED) {
      throw new BadRequestException(
        'Only an approved commission can be marked paid',
      );
    }
    return this.prisma.partnerCommission.update({
      where: { id },
      data: { status: PartnerCommissionStatus.PAID, paidAt: new Date() },
    });
  }
}
