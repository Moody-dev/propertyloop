import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ListingOwnership, LeadSource } from '../../generated/prisma/client';
import { StaffAlertsService } from '../staff-alerts/staff-alerts.service';

/**
 * Somebody interested in PropertyLoop's own stock.
 *
 * House stock is filed by a staff member, so the listing's "agent" is that
 * person's own account — which meant a viewing request, an offer or a message
 * reached their personal inbox on the website and appeared nowhere in the team
 * portal. If they did not think to look, it was lost.
 *
 * Every enquiry on house stock is now also a lead, owned by whoever sourced
 * the property, and the team is told. Agents' own listings are untouched:
 * those enquiries belong to the agent.
 */

export type EnquiryKind = 'VIEWING' | 'OFFER' | 'MESSAGE';

export interface HouseEnquiry {
  listingId: string;
  kind: EnquiryKind;
  name: string;
  phone?: string | null;
  email?: string | null;
  /** What they said, or what they asked for. */
  message?: string | null;
  buyerUserId?: string | null;
  /** For an offer, so the lead carries the number. */
  amountNaira?: number | null;
}

function naira(amount: number): string {
  return `₦${Math.round(amount).toLocaleString('en-NG')}`;
}

@Injectable()
export class HouseEnquiryService {
  private readonly logger = new Logger(HouseEnquiryService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly alerts?: StaffAlertsService,
  ) {}

  /** Fire and forget: the viewing, offer or message is already saved. */
  record(enquiry: HouseEnquiry): void {
    void this.run(enquiry).catch((err: unknown) =>
      this.logger.warn(
        `House enquiry for ${enquiry.listingId} not recorded: ${(err as Error).message}`,
      ),
    );
  }

  private line(enquiry: HouseEnquiry, when: Date): string {
    const stamp = when.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      timeZone: 'Africa/Lagos',
    });
    const what =
      enquiry.kind === 'VIEWING'
        ? 'Viewing requested'
        : enquiry.kind === 'OFFER'
          ? `Offer${enquiry.amountNaira ? ` of ${naira(enquiry.amountNaira)}` : ''}`
          : 'Message sent from the website';
    return [`${stamp} — ${what}`, enquiry.message?.trim()]
      .filter(Boolean)
      .join(': ');
  }

  private async run(enquiry: HouseEnquiry) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: enquiry.listingId },
      select: {
        id: true,
        title: true,
        ownership: true,
        agentId: true,
        sourcedByStaffId: true,
      },
    });
    // An agent's own listing is the agent's business, not ours.
    if (!listing || listing.ownership !== ListingOwnership.HOUSE) return;

    const now = new Date();
    const note = this.line(enquiry, now);
    const phone = enquiry.phone?.trim() ?? '';

    // One lead per person per property: a viewing after a message is the same
    // buyer, and two rows would be two people as far as the queue is concerned.
    const identity = [
      ...(enquiry.buyerUserId ? [{ buyerUserId: enquiry.buyerUserId }] : []),
      ...(phone ? [{ phone }] : []),
    ];
    const existing = identity.length
      ? await this.prisma.lead.findFirst({
          where: { listingId: listing.id, OR: identity },
          orderBy: { createdAt: 'desc' },
          select: { id: true, notes: true },
        })
      : null;

    if (existing) {
      await this.prisma.lead.update({
        where: { id: existing.id },
        data: {
          notes: [existing.notes, note].filter(Boolean).join('\n').slice(-2000),
          ...(enquiry.amountNaira != null && {
            budgetNaira: BigInt(Math.round(enquiry.amountNaira)),
          }),
        },
      });
    } else {
      await this.prisma.lead.create({
        data: {
          listingId: listing.id,
          agentId: listing.agentId,
          buyerUserId: enquiry.buyerUserId ?? null,
          name: enquiry.name.trim() || 'Website enquiry',
          phone,
          email: enquiry.email?.trim() || null,
          message: enquiry.message?.trim() || null,
          source: LeadSource.LISTING_PAGE,
          notes: note,
          // Whoever sourced the property works it; the portal shows it in
          // their queue and measures the response against the 30-minute SLA.
          ownerStaffId: listing.sourcedByStaffId,
          ...(enquiry.amountNaira != null && {
            budgetNaira: BigInt(Math.round(enquiry.amountNaira)),
          }),
        },
      });
    }

    this.alerts?.houseStockEnquiry(
      listing.id,
      listing.title,
      enquiry.kind,
      enquiry.name.trim() || 'Someone',
      listing.sourcedByStaffId,
    );
  }
}
