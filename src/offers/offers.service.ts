import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  ListingType,
  OfferActor,
  OfferEventType,
  OfferStatus,
  Prisma,
  PurchaseStatus,
  PurchaseStepState,
  Role,
} from '../../generated/prisma/client';
import { CreateOfferDto } from './dto/create-offer.dto';
import { CounterOfferDto } from './dto/counter-offer.dto';
import { ListOffersDto } from './dto/list-offers.dto';
import { UpdateStepDto } from './dto/update-step.dto';

// The standard 5-step purchase journey, seeded when an offer is accepted.
// Step 1 is already done (the offer was just accepted); step 2 becomes active.
const PURCHASE_STEPS: { key: string; title: string; detail: string }[] = [
  {
    key: 'OFFER_ACCEPTED',
    title: 'Offer accepted',
    detail: 'Seller accepted the offer',
  },
  {
    key: 'SOLICITORS',
    title: 'Solicitors instructed',
    detail: 'Both sides confirm legal counsel',
  },
  {
    key: 'TITLE_SEARCH',
    title: 'Title search & due diligence',
    detail: 'C of O verification and survey',
  },
  {
    key: 'INSPECTION',
    title: 'Property inspection',
    detail: 'Structural inspection',
  },
  {
    key: 'COMPLETION',
    title: 'Completion & handover',
    detail: 'Sign deed off-platform, collect keys',
  },
];

const LISTING_SELECT = {
  id: true,
  title: true,
  slug: true,
  coverImage: true,
  location: true,
  address: true,
  priceNaira: true,
  priceLabel: true,
  type: true,
} as const;

const USER_SELECT = {
  id: true,
  name: true,
  avatarUrl: true,
  phone: true,
} as const;

function naira(value: bigint | number): string {
  return `₦${Number(value).toLocaleString('en-NG')}`;
}

@Injectable()
export class OffersService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Buyer: create an offer ──────────────────────────────────────────────

  async create(buyerId: string, dto: CreateOfferDto) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: dto.listingId },
      select: { id: true, agentId: true, type: true },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.type !== ListingType.SALE) {
      throw new BadRequestException('Offers can only be made on listings for sale');
    }
    if (listing.agentId === buyerId) {
      throw new BadRequestException('You cannot make an offer on your own listing');
    }

    // One live offer per buyer per listing — block a duplicate while one is open.
    const existing = await this.prisma.offer.findFirst({
      where: {
        listingId: listing.id,
        buyerId,
        status: { in: [OfferStatus.PENDING, OfferStatus.COUNTERED] },
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        'You already have an active offer on this property',
      );
    }

    const amount = BigInt(dto.amountNaira);
    const offer = await this.prisma.offer.create({
      data: {
        listingId: listing.id,
        buyerId,
        agentId: listing.agentId,
        amountNaira: amount,
        currentAmountNaira: amount,
        financing: dto.financing ?? undefined,
        note: dto.note,
        closeDate: dto.closeDate,
        subjectToInspection: dto.subjectToInspection ?? undefined,
        expiresAt: dto.expiresAt,
        status: OfferStatus.PENDING,
        lastActor: OfferActor.BUYER,
        events: {
          create: {
            type: OfferEventType.OFFER,
            actor: OfferActor.BUYER,
            amountNaira: amount,
            note: dto.note,
          },
        },
      },
      include: this.offerInclude(),
    });
    return this.serializeOffer(offer);
  }

  // ─── Listing offers (buyer + agent perspectives) ─────────────────────────

  async listForBuyer(buyerId: string, dto: ListOffersDto) {
    return this.listOffers({ buyerId }, dto);
  }

  async listForAgent(agentId: string, dto: ListOffersDto) {
    return this.listOffers({ agentId }, dto);
  }

  private async listOffers(
    scope: { buyerId?: string; agentId?: string },
    dto: ListOffersDto,
  ) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 24;
    const skip = (page - 1) * limit;

    const where: Prisma.OfferWhereInput = { ...scope };
    if (dto.status) where.status = dto.status;

    const [items, total] = await Promise.all([
      this.prisma.offer.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
        include: this.offerInclude(),
      }),
      this.prisma.offer.count({ where }),
    ]);

    return {
      items: items.map((o) => this.serializeOffer(o)),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  async getById(userId: string, offerId: string) {
    const offer = await this.prisma.offer.findUnique({
      where: { id: offerId },
      include: {
        ...this.offerInclude(),
        events: { orderBy: { createdAt: 'asc' } },
        purchase: { include: { steps: { orderBy: { order: 'asc' } } } },
      },
    });
    if (!offer) throw new NotFoundException('Offer not found');
    this.assertParticipant(offer, userId);
    return this.serializeOffer(offer);
  }

  // ─── Negotiation actions ─────────────────────────────────────────────────

  async counter(userId: string, offerId: string, dto: CounterOfferDto) {
    const offer = await this.loadActiveOffer(offerId);
    const actor = this.actorFor(offer, userId);
    // You can only counter the *other* side's standing figure.
    if (offer.lastActor === actor) {
      throw new ForbiddenException(
        'Waiting on the other party — you cannot counter your own offer',
      );
    }

    const amount = BigInt(dto.amountNaira);
    const updated = await this.prisma.offer.update({
      where: { id: offer.id },
      data: {
        status: OfferStatus.COUNTERED,
        currentAmountNaira: amount,
        lastActor: actor,
        events: {
          create: {
            type: OfferEventType.COUNTER,
            actor,
            amountNaira: amount,
            note: dto.note,
          },
        },
      },
      include: this.offerInclude(),
    });
    return this.serializeOffer(updated);
  }

  async accept(userId: string, offerId: string) {
    const offer = await this.loadActiveOffer(offerId);
    const actor = this.actorFor(offer, userId);
    // You accept the figure the *other* side put on the table.
    if (offer.lastActor === actor) {
      throw new ForbiddenException(
        'You cannot accept your own standing offer — wait for the other party',
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.offer.update({
        where: { id: offer.id },
        data: {
          status: OfferStatus.ACCEPTED,
          events: {
            create: {
              type: OfferEventType.ACCEPT,
              actor,
              amountNaira: offer.currentAmountNaira,
            },
          },
        },
      });

      await tx.propertyPurchase.create({
        data: {
          offerId: offer.id,
          listingId: offer.listingId,
          buyerId: offer.buyerId,
          agentId: offer.agentId,
          agreedAmountNaira: offer.currentAmountNaira,
          status: PurchaseStatus.IN_PROGRESS,
          steps: {
            create: PURCHASE_STEPS.map((s, i) => ({
              order: i + 1,
              key: s.key,
              title: s.title,
              detail: s.detail,
              state:
                i === 0
                  ? PurchaseStepState.DONE
                  : i === 1
                    ? PurchaseStepState.ACTIVE
                    : PurchaseStepState.TODO,
              completedAt: i === 0 ? new Date() : null,
            })),
          },
        },
      });

      return tx.offer.findUnique({
        where: { id: offer.id },
        include: {
          ...this.offerInclude(),
          purchase: { include: { steps: { orderBy: { order: 'asc' } } } },
        },
      });
    });

    return this.serializeOffer(result!);
  }

  async decline(userId: string, offerId: string) {
    const offer = await this.loadActiveOffer(offerId);
    const actor = this.actorFor(offer, userId);
    if (offer.lastActor === actor) {
      throw new ForbiddenException(
        'You cannot decline your own standing offer',
      );
    }
    const updated = await this.prisma.offer.update({
      where: { id: offer.id },
      data: {
        status: OfferStatus.DECLINED,
        events: { create: { type: OfferEventType.DECLINE, actor } },
      },
      include: this.offerInclude(),
    });
    return this.serializeOffer(updated);
  }

  async withdraw(buyerId: string, offerId: string) {
    const offer = await this.loadActiveOffer(offerId);
    if (offer.buyerId !== buyerId) {
      throw new ForbiddenException('Only the buyer can withdraw this offer');
    }
    const updated = await this.prisma.offer.update({
      where: { id: offer.id },
      data: {
        status: OfferStatus.WITHDRAWN,
        events: { create: { type: OfferEventType.WITHDRAW, actor: OfferActor.BUYER } },
      },
      include: this.offerInclude(),
    });
    return this.serializeOffer(updated);
  }

  // ─── Purchase progress ───────────────────────────────────────────────────

  async listPurchases(userId: string) {
    const purchases = await this.prisma.propertyPurchase.findMany({
      where: { OR: [{ buyerId: userId }, { agentId: userId }] },
      orderBy: { updatedAt: 'desc' },
      include: this.purchaseInclude(),
    });
    return purchases.map((p) => this.serializePurchase(p));
  }

  async getPurchase(userId: string, purchaseId: string) {
    const purchase = await this.prisma.propertyPurchase.findUnique({
      where: { id: purchaseId },
      include: this.purchaseInclude(),
    });
    if (!purchase) throw new NotFoundException('Purchase not found');
    if (purchase.buyerId !== userId && purchase.agentId !== userId) {
      throw new ForbiddenException('This purchase is not yours');
    }
    return this.serializePurchase(purchase);
  }

  /** Only the listing agent drives the purchase milestones. */
  async updateStep(
    userId: string,
    purchaseId: string,
    stepId: string,
    dto: UpdateStepDto,
  ) {
    const purchase = await this.prisma.propertyPurchase.findUnique({
      where: { id: purchaseId },
      include: { steps: { orderBy: { order: 'asc' } } },
    });
    if (!purchase) throw new NotFoundException('Purchase not found');
    if (purchase.agentId !== userId) {
      throw new ForbiddenException('Only the agent can update purchase steps');
    }
    const step = purchase.steps.find((s) => s.id === stepId);
    if (!step) throw new NotFoundException('Step not found');

    const markingDone =
      dto.state === PurchaseStepState.DONE &&
      step.state !== PurchaseStepState.DONE;

    await this.prisma.$transaction(async (tx) => {
      await tx.purchaseStep.update({
        where: { id: step.id },
        data: {
          ...(dto.state !== undefined && { state: dto.state }),
          ...(dto.detail !== undefined && { detail: dto.detail }),
          ...(dto.eta !== undefined && { eta: dto.eta }),
          ...(dto.state === PurchaseStepState.DONE && { completedAt: new Date() }),
        },
      });

      if (markingDone) {
        // Promote the next TODO step to ACTIVE.
        const next = purchase.steps.find(
          (s) => s.order > step.order && s.state === PurchaseStepState.TODO,
        );
        if (next) {
          await tx.purchaseStep.update({
            where: { id: next.id },
            data: { state: PurchaseStepState.ACTIVE },
          });
        }
        // All steps done → purchase complete.
        const remaining = purchase.steps.filter(
          (s) => s.id !== step.id && s.state !== PurchaseStepState.DONE,
        );
        if (remaining.length === 0) {
          await tx.propertyPurchase.update({
            where: { id: purchase.id },
            data: { status: PurchaseStatus.COMPLETED },
          });
        }
      }
    });

    return this.getPurchase(userId, purchaseId);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private offerInclude() {
    return {
      listing: { select: LISTING_SELECT },
      buyer: { select: USER_SELECT },
      agent: { select: USER_SELECT },
    };
  }

  private purchaseInclude() {
    return {
      listing: { select: LISTING_SELECT },
      buyer: { select: USER_SELECT },
      agent: { select: USER_SELECT },
      steps: { orderBy: { order: 'asc' as const } },
    };
  }

  private async loadActiveOffer(offerId: string) {
    const offer = await this.prisma.offer.findUnique({ where: { id: offerId } });
    if (!offer) throw new NotFoundException('Offer not found');
    if (
      offer.status !== OfferStatus.PENDING &&
      offer.status !== OfferStatus.COUNTERED
    ) {
      throw new BadRequestException(
        `This offer is ${offer.status.toLowerCase()} and can no longer be changed`,
      );
    }
    return offer;
  }

  private assertParticipant(
    offer: { buyerId: string; agentId: string },
    userId: string,
  ) {
    if (offer.buyerId !== userId && offer.agentId !== userId) {
      throw new ForbiddenException('This offer is not yours');
    }
  }

  private actorFor(
    offer: { buyerId: string; agentId: string },
    userId: string,
  ): OfferActor {
    if (offer.buyerId === userId) return OfferActor.BUYER;
    if (offer.agentId === userId) return OfferActor.AGENT;
    throw new ForbiddenException('This offer is not yours');
  }

  private serializeOffer(offer: any) {
    return {
      id: offer.id,
      status: offer.status,
      listingId: offer.listingId,
      buyerId: offer.buyerId,
      agentId: offer.agentId,
      amountNaira: Number(offer.amountNaira),
      amountLabel: naira(offer.amountNaira),
      currentAmountNaira: Number(offer.currentAmountNaira),
      currentAmountLabel: naira(offer.currentAmountNaira),
      financing: offer.financing,
      note: offer.note,
      closeDate: offer.closeDate,
      subjectToInspection: offer.subjectToInspection,
      lastActor: offer.lastActor,
      expiresAt: offer.expiresAt,
      createdAt: offer.createdAt,
      updatedAt: offer.updatedAt,
      listing: offer.listing
        ? { ...offer.listing, priceNaira: Number(offer.listing.priceNaira) }
        : undefined,
      buyer: offer.buyer,
      agent: offer.agent,
      events: offer.events?.map((e: any) => ({
        id: e.id,
        type: e.type,
        actor: e.actor,
        amountNaira: e.amountNaira != null ? Number(e.amountNaira) : null,
        amountLabel: e.amountNaira != null ? naira(e.amountNaira) : null,
        note: e.note,
        createdAt: e.createdAt,
      })),
      purchase: offer.purchase
        ? this.serializePurchase(offer.purchase)
        : undefined,
    };
  }

  private serializePurchase(purchase: any) {
    return {
      id: purchase.id,
      offerId: purchase.offerId,
      listingId: purchase.listingId,
      buyerId: purchase.buyerId,
      agentId: purchase.agentId,
      status: purchase.status,
      agreedAmountNaira: Number(purchase.agreedAmountNaira),
      agreedAmountLabel: naira(purchase.agreedAmountNaira),
      createdAt: purchase.createdAt,
      updatedAt: purchase.updatedAt,
      listing: purchase.listing
        ? { ...purchase.listing, priceNaira: Number(purchase.listing.priceNaira) }
        : undefined,
      buyer: purchase.buyer,
      agent: purchase.agent,
      steps: purchase.steps?.map((s: any) => ({
        id: s.id,
        order: s.order,
        key: s.key,
        title: s.title,
        detail: s.detail,
        state: s.state,
        eta: s.eta,
        completedAt: s.completedAt,
      })),
    };
  }
}
