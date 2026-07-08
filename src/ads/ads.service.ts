import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PaystackService } from '../payments/paystack.service';
import { MediaUrlService } from '../media/media-url.service';
import {
  AdPlacement,
  AdStatus,
  Prisma,
} from '../../generated/prisma/client';
import { CreateAdDto } from './dto/create-ad.dto';

// Flat weekly rate per placement (naira). Single source of truth — the
// amount is always computed server-side so a client can't price its own ad.
export const AD_WEEKLY_RATES: Record<AdPlacement, number> = {
  [AdPlacement.SPLASH]: 150_000,
  [AdPlacement.HOME_BANNER]: 100_000,
  [AdPlacement.SEARCH_INLINE]: 60_000,
  [AdPlacement.HOME_FEED]: 50_000,
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function quoteFor(placement: AdPlacement, weeks: number) {
  return AD_WEEKLY_RATES[placement] * weeks;
}

@Injectable()
export class AdsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paystack: PaystackService,
    private readonly mediaUrl: MediaUrlService,
    private readonly config: ConfigService,
  ) {}

  // ─── Public: serving + tracking ───────────────────────────────────────────

  /** Active ads for a placement, inside their run window, rotation-ordered. */
  async serve(placement: AdPlacement) {
    const now = new Date();
    const items = await this.prisma.brandAd.findMany({
      where: {
        placement,
        status: AdStatus.ACTIVE,
        startAt: { lte: now },
        endAt: { gte: now },
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      take: 5,
    });
    return items.map((a) => this.serializePublic(a));
  }

  /** Fire-and-forget counters. Missing/inactive ads no-op rather than 404 —
   *  the client shouldn't retry or surface tracking failures. */
  async trackImpression(id: string) {
    await this.prisma.brandAd
      .update({ where: { id }, data: { impressions: { increment: 1 } } })
      .catch(() => undefined);
    return { ok: true };
  }

  async trackClick(id: string) {
    await this.prisma.brandAd
      .update({ where: { id }, data: { clicks: { increment: 1 } } })
      .catch(() => undefined);
    return { ok: true };
  }

  /** Rate card for the self-serve form (client renders prices from this). */
  pricing() {
    return {
      currency: 'NGN',
      weeklyRates: AD_WEEKLY_RATES,
    };
  }

  // ─── Brand (authenticated advertiser) ─────────────────────────────────────

  async create(ownerUserId: string, dto: CreateAdDto) {
    const startAt = new Date(dto.startAt);
    if (Number.isNaN(startAt.getTime())) {
      throw new BadRequestException('Invalid start date');
    }
    // Allow "today" in any timezone but nothing clearly in the past.
    if (startAt.getTime() < Date.now() - 24 * 60 * 60 * 1000) {
      throw new BadRequestException('Start date cannot be in the past');
    }

    const endAt = new Date(startAt.getTime() + dto.weeks * WEEK_MS);
    const ad = await this.prisma.brandAd.create({
      data: {
        ownerUserId,
        brandName: dto.brandName,
        contactEmail: dto.contactEmail,
        contactPhone: dto.contactPhone,
        imageUrl: dto.imageUrl,
        headline: dto.headline,
        body: dto.body,
        ctaLabel: dto.ctaLabel?.trim() || 'Learn more',
        ctaUrl: dto.ctaUrl,
        placement: dto.placement,
        startAt,
        endAt,
        weeks: dto.weeks,
        amountNaira: quoteFor(dto.placement, dto.weeks),
        status: AdStatus.DRAFT,
      },
    });
    return this.serializeOwner(ad);
  }

  async listMine(ownerUserId: string) {
    const items = await this.prisma.brandAd.findMany({
      where: { ownerUserId },
      orderBy: { createdAt: 'desc' },
    });
    return items.map((a) => this.serializeOwner(a));
  }

  /** Kick off Paystack checkout for a draft ad. Returns the hosted payment URL. */
  async initPayment(ownerUserId: string, adId: string, email: string) {
    const ad = await this.assertOwner(ownerUserId, adId);
    if (ad.status !== AdStatus.DRAFT) {
      throw new BadRequestException('This ad has already been paid for');
    }

    const reference = `PLAD-${adId}-${Date.now()}`;
    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') || 'http://localhost:5173';

    const { authorization_url } = await this.paystack.initializeTransaction({
      email,
      amount: ad.amountNaira * 100, // kobo
      reference,
      callback_url: `${frontendUrl}/advertise?paid=${adId}`,
      metadata: { type: 'brand_ad', adId },
    });

    await this.prisma.brandAd.update({
      where: { id: adId },
      data: { paymentRef: reference },
    });

    return { paymentUrl: authorization_url, reference };
  }

  /** Webhook + verify-on-return. Idempotent: only a DRAFT flips to review. */
  async handleChargeSuccess(reference: string) {
    const ad = await this.prisma.brandAd.findUnique({
      where: { paymentRef: reference },
    });
    if (!ad) return; // not an ad reference — other handlers own it
    if (ad.status !== AdStatus.DRAFT) return; // already processed

    const txn = await this.paystack.verifyTransaction(reference);
    if (txn.status !== 'success') return;
    if (txn.amount !== ad.amountNaira * 100) {
      console.warn(
        `Ad payment amount mismatch for ${reference}: expected ${ad.amountNaira * 100}, got ${txn.amount}`,
      );
      return;
    }

    await this.prisma.brandAd.update({
      where: { id: ad.id },
      data: { status: AdStatus.PENDING_REVIEW, paidAt: new Date() },
    });
  }

  /** Verify-on-return for web checkout. Returns the fresh ad for the UI. */
  async verifyPayment(ownerUserId: string, adId: string) {
    const ad = await this.assertOwner(ownerUserId, adId);
    if (ad.status === AdStatus.DRAFT && ad.paymentRef) {
      await this.handleChargeSuccess(ad.paymentRef);
    }
    const fresh = await this.prisma.brandAd.findUnique({ where: { id: adId } });
    return this.serializeOwner(fresh);
  }

  // ─── Admin review ─────────────────────────────────────────────────────────

  async adminList(opts: { page: number; limit: number; status?: string }) {
    const { page, limit } = opts;
    const skip = (page - 1) * limit;

    const where: Prisma.BrandAdWhereInput = {};
    if (opts.status && opts.status in AdStatus) {
      where.status = opts.status as AdStatus;
    }

    const [items, total, pendingTotal] = await Promise.all([
      this.prisma.brandAd.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { owner: { select: { id: true, name: true, email: true } } },
      }),
      this.prisma.brandAd.count({ where }),
      this.prisma.brandAd.count({ where: { status: AdStatus.PENDING_REVIEW } }),
    ]);

    return {
      items: items.map((a) => this.serializeAdmin(a)),
      total,
      pendingTotal,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  async adminSetStatus(
    adId: string,
    action: 'approve' | 'reject' | 'pause' | 'resume',
    adminNote?: string,
  ) {
    const ad = await this.prisma.brandAd.findUnique({ where: { id: adId } });
    if (!ad) throw new NotFoundException('Ad not found');

    let data: Prisma.BrandAdUpdateInput;
    switch (action) {
      case 'approve': {
        if (ad.status !== AdStatus.PENDING_REVIEW && ad.status !== AdStatus.PAUSED) {
          throw new BadRequestException('Only paid ads awaiting review (or paused) can be approved');
        }
        // If review landed after the requested go-live, shift the window
        // forward so the brand still gets the full run they paid for.
        const now = new Date();
        const shift = ad.startAt.getTime() < now.getTime();
        data = {
          status: AdStatus.ACTIVE,
          ...(shift && {
            startAt: now,
            endAt: new Date(now.getTime() + ad.weeks * WEEK_MS),
          }),
          ...(adminNote !== undefined && { adminNote }),
        };
        break;
      }
      case 'reject':
        if (ad.status === AdStatus.ACTIVE) {
          throw new BadRequestException('Pause an active ad instead of rejecting it');
        }
        data = { status: AdStatus.REJECTED, ...(adminNote !== undefined && { adminNote }) };
        break;
      case 'pause':
        if (ad.status !== AdStatus.ACTIVE) {
          throw new BadRequestException('Only active ads can be paused');
        }
        data = { status: AdStatus.PAUSED, ...(adminNote !== undefined && { adminNote }) };
        break;
      case 'resume':
        if (ad.status !== AdStatus.PAUSED) {
          throw new BadRequestException('Only paused ads can be resumed');
        }
        data = { status: AdStatus.ACTIVE, ...(adminNote !== undefined && { adminNote }) };
        break;
    }

    const updated = await this.prisma.brandAd.update({
      where: { id: adId },
      data,
      include: { owner: { select: { id: true, name: true, email: true } } },
    });
    return this.serializeAdmin(updated);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async assertOwner(ownerUserId: string, adId: string) {
    const ad = await this.prisma.brandAd.findUnique({ where: { id: adId } });
    if (!ad) throw new NotFoundException('Ad not found');
    if (ad.ownerUserId !== ownerUserId) {
      throw new ForbiddenException('You can only manage your own ads');
    }
    return ad;
  }

  /** What the app renders — no advertiser contact/money details. */
  private serializePublic(a: any) {
    return {
      id: a.id,
      brandName: a.brandName,
      imageUrl: this.mediaUrl.rewriteMany([a.imageUrl])[0],
      headline: a.headline,
      body: a.body,
      ctaLabel: a.ctaLabel,
      ctaUrl: a.ctaUrl,
      placement: a.placement,
    };
  }

  /** What the brand sees about its own ad (adds status, window, money, stats). */
  private serializeOwner(a: any) {
    return {
      ...this.serializePublic(a),
      status: a.status,
      startAt: a.startAt,
      endAt: a.endAt,
      weeks: a.weeks,
      amountNaira: a.amountNaira,
      paidAt: a.paidAt,
      impressions: a.impressions,
      clicks: a.clicks,
      adminNote: a.adminNote,
      createdAt: a.createdAt,
    };
  }

  private serializeAdmin(a: any) {
    return {
      ...this.serializeOwner(a),
      contactEmail: a.contactEmail,
      contactPhone: a.contactPhone,
      priority: a.priority,
      owner: a.owner ?? null,
    };
  }
}
