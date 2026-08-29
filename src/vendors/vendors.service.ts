import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { assertNotObjectionable } from '../common/content-filter';
import {
  EarningStatus,
  EscrowStatus,
  JobStatus,
  Prisma,
  Role,
  VendorServicePriceMode,
} from '../../generated/prisma/client';
import { ListVendorsDto } from './dto/list-vendors.dto';
import { UpdateVendorProfileDto } from './dto/update-vendor-profile.dto';
import { CreateVendorReviewDto } from './dto/create-review.dto';
import { CreateVendorServiceDto } from './dto/create-vendor-service.dto';
import { UpdateVendorServiceDto } from './dto/update-vendor-service.dto';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { AddBlackoutDto } from './dto/add-blackout.dto';

// Mirrors the mobile vendor-availability default (Mon–Fri 8–6, Sat 9–2, Sun off)
const DEFAULT_SCHEDULE = [
  { day: 'Monday', on: true, hours: '8:00 AM – 6:00 PM' },
  { day: 'Tuesday', on: true, hours: '8:00 AM – 6:00 PM' },
  { day: 'Wednesday', on: true, hours: '8:00 AM – 6:00 PM' },
  { day: 'Thursday', on: true, hours: '8:00 AM – 6:00 PM' },
  { day: 'Friday', on: true, hours: '8:00 AM – 6:00 PM' },
  { day: 'Saturday', on: true, hours: '9:00 AM – 2:00 PM' },
  { day: 'Sunday', on: false, hours: 'Off' },
];

/** Parse an ISO date (yyyy-mm-dd) to a UTC-midnight Date for a @db.Date column. */
function toDateOnly(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
}

@Injectable()
export class VendorsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Public directory ────────────────────────────────────────────────────

  async list(dto: ListVendorsDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 24;
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = {
      role: Role.VENDOR,
      isActive: true,
      deletedAt: null,
      // Show every available vendor, including those who haven't listed a
      // bookable service yet — buyers can now message them to enquire (the
      // public profile offers an "Enquire" chat when there's no service menu).
      // availableForHire (re-applied at where.vendorProfile below) still keeps
      // vendors who've switched themselves off out of the directory.
      vendorProfile: {
        is: {
          availableForHire: true,
        },
      },
    };

    if (dto.search) {
      where.OR = [
        { name: { contains: dto.search, mode: 'insensitive' } },
        { location: { contains: dto.search, mode: 'insensitive' } },
        {
          vendorProfile: {
            is: { serviceCategory: { contains: dto.search, mode: 'insensitive' } },
          },
        },
      ];
    }

    if (dto.location) {
      where.location = { contains: dto.location, mode: 'insensitive' };
    }

    const vendorProfileFilters: Prisma.VendorProfileWhereInput = {
      availableForHire: true,
    };
    if (dto.category) {
      vendorProfileFilters.serviceCategory = {
        equals: dto.category,
        mode: 'insensitive',
      };
    }
    if (dto.minRating != null) {
      vendorProfileFilters.rating = { gte: Number(dto.minRating) };
    }
    where.vendorProfile = { is: vendorProfileFilters };

    const orderBy: Prisma.UserOrderByWithRelationInput[] = [];
    switch (dto.sort) {
      case 'most_jobs':
        orderBy.push({ vendorProfile: { jobsCount: 'desc' } });
        break;
      case 'price_asc':
        orderBy.push({ vendorProfile: { priceNum: 'asc' } });
        break;
      case 'newest':
        orderBy.push({ createdAt: 'desc' });
        break;
      case 'top_rated':
      default:
        orderBy.push({ vendorProfile: { rating: 'desc' } });
    }

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: {
          vendorProfile: true,
          vendorServices: VendorsService.CHEAPEST_SERVICE,
        },
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: items.map((u) => this.serializePublic(u)),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  // ─── Public single profile ───────────────────────────────────────────────

  async getPublicProfile(vendorId: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        id: vendorId,
        role: Role.VENDOR,
        isActive: true,
        deletedAt: null,
      },
      include: {
        vendorProfile: true,
        vendorServices: VendorsService.CHEAPEST_SERVICE,
      },
    });
    if (!user || !user.vendorProfile) throw new NotFoundException('Vendor not found');

    const reviews = await this.prisma.vendorReview.findMany({
      where: { vendorUserId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return {
      ...this.serializePublic(user),
      reviews,
    };
  }

  // ─── Authenticated vendor: own profile + dashboard stats ─────────────────

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        vendorProfile: true,
        settings: true,
        vendorServices: VendorsService.CHEAPEST_SERVICE,
      },
    });
    if (!user || user.role !== Role.VENDOR || !user.vendorProfile) {
      throw new ForbiddenException('Vendor profile not found');
    }
    return this.serializePrivate(user);
  }

  async updateMe(userId: string, dto: UpdateVendorProfileDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { vendorProfile: true },
    });
    if (!user || user.role !== Role.VENDOR || !user.vendorProfile) {
      throw new ForbiddenException('Vendor profile not found');
    }

    assertNotObjectionable(dto.bio, 'Bio');

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.location !== undefined && { location: dto.location }),
        ...(dto.bio !== undefined && { bio: dto.bio }),
        ...(dto.avatarUrl !== undefined && { avatarUrl: dto.avatarUrl }),
        vendorProfile: {
          update: {
            ...(dto.serviceCategory !== undefined && { serviceCategory: dto.serviceCategory }),
            ...(dto.yearsExperience !== undefined && { yearsExperience: dto.yearsExperience }),
            ...(dto.serviceArea !== undefined && { serviceArea: dto.serviceArea }),
            ...(dto.priceLabel !== undefined && { priceLabel: dto.priceLabel }),
            ...(dto.priceNum !== undefined && { priceNum: dto.priceNum }),
            ...(dto.website !== undefined && { website: dto.website }),
            ...(dto.bannerImage !== undefined && { bannerImage: dto.bannerImage }),
            ...(dto.portfolioImages !== undefined && { portfolioImages: dto.portfolioImages }),
            ...(dto.availableForHire !== undefined && { availableForHire: dto.availableForHire }),
          },
        },
      },
      include: {
        vendorProfile: true,
        settings: true,
        vendorServices: VendorsService.CHEAPEST_SERVICE,
      },
    });

    return this.serializePrivate(updated);
  }

  async getStats(userId: string) {
    const profile = await this.prisma.vendorProfile.findUnique({
      where: { userId },
    });
    if (!profile) throw new ForbiddenException('Vendor profile not found');

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [
      pendingJobs,
      activeJobs,
      completedJobs,
      totalJobs,
      earningsPaidAgg,
      earningsPendingAgg,
      earningsAvailableAgg,
      earningsProcessingAgg,
      earningsThisMonthAgg,
      earningsEarnedAgg,
      reviewsCount,
      reviewsAvg,
      fiveStarCount,
    ] = await Promise.all([
      this.prisma.vendorJob.count({
        where: { vendorUserId: userId, status: JobStatus.PENDING },
      }),
      this.prisma.vendorJob.count({
        where: {
          vendorUserId: userId,
          status: { in: [JobStatus.ACCEPTED, JobStatus.IN_PROGRESS] },
        },
      }),
      this.prisma.vendorJob.count({
        where: {
          vendorUserId: userId,
          status: { in: [JobStatus.COMPLETED, JobStatus.PAID] },
          // A refunded job is no longer a delivered job — keeps this count in
          // step with profile.jobsCount, which is decremented on refund.
          escrowStatus: { not: EscrowStatus.REFUNDED },
        },
      }),
      this.prisma.vendorJob.count({ where: { vendorUserId: userId } }),
      this.prisma.vendorEarning.aggregate({
        where: { vendorUserId: userId, status: EarningStatus.PAID },
        _sum: { amount: true },
      }),
      this.prisma.vendorEarning.aggregate({
        where: {
          vendorUserId: userId,
          // "In escrow" on the dashboard: locked, or clearing to the bank.
          status: { in: [EarningStatus.PENDING, EarningStatus.PROCESSING] },
        },
        _sum: { amount: true },
      }),
      this.prisma.vendorEarning.aggregate({
        where: { vendorUserId: userId, status: EarningStatus.AVAILABLE },
        _sum: { amount: true },
      }),
      // Withdrawn and clearing to the bank — a payout is in flight. Surfaced so
      // the dashboard can show the same "Processing payout" state the Earnings
      // screen does (they were inconsistent: one showed it, the other didn't).
      this.prisma.vendorEarning.aggregate({
        where: { vendorUserId: userId, status: EarningStatus.PROCESSING },
        _sum: { amount: true },
      }),
      // "Earned this month" — must match vendor-earnings.service.ts's
      // definition (status AVAILABLE/PROCESSING/PAID, by createdAt) so the
      // dashboard tile and the Earnings screen never show different numbers
      // for the same label. Previously this only counted PAID-and-transferred
      // money by paidAt, which stayed ₦0 until a bank payout actually cleared
      // — even for a vendor who'd clearly earned money this month.
      this.prisma.vendorEarning.aggregate({
        where: {
          vendorUserId: userId,
          status: {
            in: [
              EarningStatus.AVAILABLE,
              EarningStatus.PROCESSING,
              EarningStatus.PAID,
            ],
          },
          createdAt: { gte: startOfMonth },
        },
        _sum: { amount: true },
      }),
      // Lifetime earned — same definition as the Earnings screen's "Total"
      // (money that left escrow and belongs to the vendor), so the web
      // dashboard and the app never show different totals.
      this.prisma.vendorEarning.aggregate({
        where: {
          vendorUserId: userId,
          status: {
            in: [
              EarningStatus.AVAILABLE,
              EarningStatus.PROCESSING,
              EarningStatus.PAID,
            ],
          },
        },
        _sum: { amount: true },
      }),
      this.prisma.vendorReview.count({ where: { vendorUserId: userId } }),
      this.prisma.vendorReview.aggregate({
        where: { vendorUserId: userId },
        _avg: { rating: true },
      }),
      this.prisma.vendorReview.count({
        where: { vendorUserId: userId, rating: 5 },
      }),
    ]);

    const paid = earningsPaidAgg._sum.amount ?? 0;
    const pending = earningsPendingAgg._sum.amount ?? 0;
    const available = earningsAvailableAgg._sum.amount ?? 0;
    const processing = earningsProcessingAgg._sum.amount ?? 0;
    const thisMonth = earningsThisMonthAgg._sum.amount ?? 0;
    const earnedTotal = earningsEarnedAgg._sum.amount ?? 0;

    return {
      profile: {
        rating: profile.rating,
        jobsCount: profile.jobsCount,
        verified: profile.verified,
        availableForHire: profile.availableForHire,
      },
      jobs: {
        pending: pendingJobs,
        active: activeJobs,
        completed: completedJobs,
        total: totalJobs,
      },
      earnings: {
        total: earnedTotal,
        paid,
        pending,
        available,
        processing,
        thisMonth,
      },
      reviews: {
        total: reviewsCount,
        averageRating: Number((reviewsAvg._avg.rating ?? 0).toFixed(2)),
        fiveStarPct:
          reviewsCount === 0 ? 0 : Math.round((fiveStarCount / reviewsCount) * 100),
      },
    };
  }

  // ─── Reviews ──────────────────────────────────────────────────────────────

  async listReviews(vendorId: string) {
    const vendor = await this.prisma.user.findFirst({
      where: { id: vendorId, role: Role.VENDOR, deletedAt: null },
      select: { id: true },
    });
    if (!vendor) throw new NotFoundException('Vendor not found');
    return this.prisma.vendorReview.findMany({
      where: { vendorUserId: vendorId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createReview(
    vendorId: string,
    dto: CreateVendorReviewDto,
    reviewerUserId?: string,
  ) {
    const vendor = await this.prisma.user.findFirst({
      where: { id: vendorId, role: Role.VENDOR, deletedAt: null },
      include: { vendorProfile: true },
    });
    if (!vendor || !vendor.vendorProfile) throw new NotFoundException('Vendor not found');

    assertNotObjectionable(dto.comment, 'Review');

    let clientName = dto.reviewerName?.trim();
    let clientAvatar = dto.reviewerAvatar;
    if (reviewerUserId) {
      const reviewer = await this.prisma.user.findUnique({
        where: { id: reviewerUserId },
        select: { name: true, avatarUrl: true },
      });
      clientName = reviewer?.name || clientName || 'Anonymous';
      clientAvatar = clientAvatar || reviewer?.avatarUrl || undefined;
    }
    if (!clientName) clientName = 'Anonymous';

    // Optionally link to a specific completed job
    let jobId: string | undefined;
    let jobTitle = dto.jobTitle || '';
    if (dto.jobId) {
      const job = await this.prisma.vendorJob.findUnique({
        where: { id: dto.jobId },
      });
      if (job && job.vendorUserId === vendorId) {
        jobId = job.id;
        jobTitle = jobTitle || job.title;
      }
    }

    const review = await this.prisma.vendorReview.create({
      data: {
        vendorUserId: vendorId,
        jobId,
        clientName,
        clientAvatar,
        rating: dto.rating,
        comment: dto.comment,
        jobTitle,
      },
    });

    // Recompute the vendor's average rating
    const agg = await this.prisma.vendorReview.aggregate({
      where: { vendorUserId: vendorId },
      _avg: { rating: true },
    });
    await this.prisma.vendorProfile.update({
      where: { userId: vendorId },
      data: { rating: Number((agg._avg.rating ?? 0).toFixed(2)) },
    });

    return review;
  }

  /** Vendor posts a public reply to one of their own reviews (vendor-reply screen). */
  async replyToReview(vendorUserId: string, reviewId: string, reply: string) {
    const review = await this.prisma.vendorReview.findUnique({
      where: { id: reviewId },
      select: { vendorUserId: true },
    });
    if (!review) throw new NotFoundException('Review not found');
    if (review.vendorUserId !== vendorUserId) {
      throw new ForbiddenException('This review is not on your profile');
    }
    assertNotObjectionable(reply, 'Reply');
    return this.prisma.vendorReview.update({
      where: { id: reviewId },
      data: { reply, repliedAt: new Date() },
    });
  }

  // ─── Stats ────────────────────────────────────────────────────────────────

  async getPublicStats() {
    const allVendors = await this.prisma.user.findMany({
      where: {
        role: Role.VENDOR,
        isActive: true,
        deletedAt: null,
        vendorProfile: { is: { availableForHire: true } },
      },
      include: { vendorProfile: true },
    });

    // Count by category
    const categoryCounts: Record<string, number> = {};
    for (const vendor of allVendors) {
      const cat = vendor.vendorProfile?.serviceCategory || 'Other';
      categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;
    }

    return {
      total: allVendors.length,
      byCategory: categoryCounts,
      averageRating:
        allVendors.length > 0
          ? Number(
              (
                allVendors.reduce((sum, v) => sum + (v.vendorProfile?.rating ?? 0), 0) /
                allVendors.length
              ).toFixed(2),
            )
          : 0,
    };
  }

  // ─── Service menu (vendor-menu + book-service screens) ─────────────────────

  /** Owner view — includes archived (inactive) services. */
  async listMyServices(userId: string) {
    const services = await this.prisma.vendorService.findMany({
      where: { vendorUserId: userId },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return services.map((s) => this.serializeService(s));
  }

  /** Public view — only active services, for a vendor's profile/booking page. */
  async listPublicServices(vendorId: string) {
    const vendor = await this.prisma.user.findFirst({
      where: { id: vendorId, role: Role.VENDOR, deletedAt: null },
      select: { id: true },
    });
    if (!vendor) throw new NotFoundException('Vendor not found');
    const services = await this.prisma.vendorService.findMany({
      where: { vendorUserId: vendorId, active: true },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return services.map((s) => this.serializeService(s));
  }

  /**
   * Keep VendorProfile.priceNum equal to the cheapest active service.
   *
   * Reads derive the displayed price from the service menu directly, but the
   * directory's `sort=price_asc` orders in the database and can't reach into a
   * to-many relation — so without this the list would sort on a number with no
   * relationship to the price it shows. Best-effort: a vendor whose sort key
   * lags briefly is a far smaller problem than a failed service save.
   */
  private async syncHeadlinePrice(vendorUserId: string) {
    try {
      const cheapest = await this.prisma.vendorService.findFirst({
        where: { vendorUserId, active: true },
        orderBy: { priceNaira: 'asc' },
        select: { priceNaira: true },
      });
      await this.prisma.vendorProfile.updateMany({
        where: { userId: vendorUserId },
        data: { priceNum: cheapest?.priceNaira ?? null },
      });
    } catch {
      /* sort key only — never fail the caller's write over it */
    }
  }

  async createService(userId: string, dto: CreateVendorServiceDto) {
    const service = await this.prisma.vendorService.create({
      data: {
        vendorUserId: userId,
        name: dto.name,
        description: dto.description,
        priceNaira: dto.priceNaira,
        priceMode: dto.priceMode ?? VendorServicePriceMode.FIXED,
        duration: dto.duration,
        displayOrder: dto.displayOrder ?? 0,
      },
    });
    await this.syncHeadlinePrice(userId);
    return this.serializeService(service);
  }

  async updateService(
    userId: string,
    serviceId: string,
    dto: UpdateVendorServiceDto,
  ) {
    await this.assertOwnsService(userId, serviceId);
    const service = await this.prisma.vendorService.update({
      where: { id: serviceId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.priceNaira !== undefined && { priceNaira: dto.priceNaira }),
        ...(dto.priceMode !== undefined && { priceMode: dto.priceMode }),
        ...(dto.duration !== undefined && { duration: dto.duration }),
        ...(dto.displayOrder !== undefined && { displayOrder: dto.displayOrder }),
        ...(dto.active !== undefined && { active: dto.active }),
      },
    });
    await this.syncHeadlinePrice(userId);
    return this.serializeService(service);
  }

  async deleteService(userId: string, serviceId: string) {
    await this.assertOwnsService(userId, serviceId);
    await this.prisma.vendorService.delete({ where: { id: serviceId } });
    await this.syncHeadlinePrice(userId);
    return { success: true };
  }

  private async assertOwnsService(userId: string, serviceId: string) {
    const service = await this.prisma.vendorService.findUnique({
      where: { id: serviceId },
      select: { vendorUserId: true },
    });
    if (!service) throw new NotFoundException('Service not found');
    if (service.vendorUserId !== userId) {
      throw new ForbiddenException('This service is not yours');
    }
  }

  private serializeService(s: {
    id: string;
    name: string;
    description: string;
    priceNaira: number;
    priceMode: VendorServicePriceMode;
    duration: string | null;
    active: boolean;
    displayOrder: number;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const amount = `₦${s.priceNaira.toLocaleString('en-NG')}`;
    return {
      id: s.id,
      name: s.name,
      description: s.description,
      priceNaira: s.priceNaira,
      priceMode: s.priceMode,
      priceLabel:
        s.priceMode === VendorServicePriceMode.FROM ? `from ${amount}` : amount,
      duration: s.duration,
      active: s.active,
      archived: !s.active,
      displayOrder: s.displayOrder,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  }

  // ─── Availability + blackouts (vendor-availability / vendor-blackout) ──────

  /** Owner view — creates a default record on first access. */
  async getMyAvailability(userId: string) {
    let availability = await this.prisma.vendorAvailability.findUnique({
      where: { vendorUserId: userId },
    });
    if (!availability) {
      availability = await this.prisma.vendorAvailability.create({
        data: { vendorUserId: userId, schedule: DEFAULT_SCHEDULE },
      });
    }
    const blackouts = await this.prisma.vendorBlackout.findMany({
      where: { vendorUserId: userId },
      orderBy: { date: 'asc' },
    });
    return this.serializeAvailability(availability, blackouts);
  }

  async updateAvailability(userId: string, dto: UpdateAvailabilityDto) {
    const data = {
      ...(dto.acceptingBookings !== undefined && {
        acceptingBookings: dto.acceptingBookings,
      }),
      ...(dto.maxJobsPerDay !== undefined && { maxJobsPerDay: dto.maxJobsPerDay }),
      ...(dto.responseCommitment !== undefined && {
        responseCommitment: dto.responseCommitment,
      }),
      ...(dto.schedule !== undefined && {
        schedule: dto.schedule as unknown as Prisma.InputJsonValue,
      }),
    };
    const availability = await this.prisma.vendorAvailability.upsert({
      where: { vendorUserId: userId },
      create: {
        vendorUserId: userId,
        schedule: (dto.schedule ??
          DEFAULT_SCHEDULE) as unknown as Prisma.InputJsonValue,
        ...(dto.acceptingBookings !== undefined && {
          acceptingBookings: dto.acceptingBookings,
        }),
        ...(dto.maxJobsPerDay !== undefined && {
          maxJobsPerDay: dto.maxJobsPerDay,
        }),
        ...(dto.responseCommitment !== undefined && {
          responseCommitment: dto.responseCommitment,
        }),
      },
      update: data,
    });
    const blackouts = await this.prisma.vendorBlackout.findMany({
      where: { vendorUserId: userId },
      orderBy: { date: 'asc' },
    });
    return this.serializeAvailability(availability, blackouts);
  }

  async addBlackouts(userId: string, dto: AddBlackoutDto) {
    // Upsert each date so re-blocking an existing day just updates its reason.
    await this.prisma.$transaction(
      dto.dates.map((iso) =>
        this.prisma.vendorBlackout.upsert({
          where: {
            vendorUserId_date: { vendorUserId: userId, date: toDateOnly(iso) },
          },
          create: { vendorUserId: userId, date: toDateOnly(iso), reason: dto.reason },
          update: { reason: dto.reason },
        }),
      ),
    );
    const blackouts = await this.prisma.vendorBlackout.findMany({
      where: { vendorUserId: userId },
      orderBy: { date: 'asc' },
    });
    return blackouts.map((b) => this.serializeBlackout(b));
  }

  async removeBlackout(userId: string, iso: string) {
    await this.prisma.vendorBlackout.deleteMany({
      where: { vendorUserId: userId, date: toDateOnly(iso) },
    });
    return { success: true };
  }

  /** Public view — what a customer needs before booking. */
  async getPublicAvailability(vendorId: string) {
    const vendor = await this.prisma.user.findFirst({
      where: { id: vendorId, role: Role.VENDOR, deletedAt: null },
      select: { id: true },
    });
    if (!vendor) throw new NotFoundException('Vendor not found');

    const availability = await this.prisma.vendorAvailability.findUnique({
      where: { vendorUserId: vendorId },
    });
    // Only surface today-or-future blackouts to customers.
    const todayIso = new Date().toISOString().slice(0, 10);
    const blackouts = await this.prisma.vendorBlackout.findMany({
      where: { vendorUserId: vendorId, date: { gte: toDateOnly(todayIso) } },
      orderBy: { date: 'asc' },
    });
    return {
      acceptingBookings: availability?.acceptingBookings ?? true,
      schedule: availability?.schedule ?? DEFAULT_SCHEDULE,
      responseCommitment: availability?.responseCommitment ?? 'Within 1 hr',
      blackouts: blackouts.map((b) => this.serializeBlackout(b)),
    };
  }

  private serializeAvailability(
    a: {
      acceptingBookings: boolean;
      maxJobsPerDay: number;
      responseCommitment: string;
      schedule: unknown;
      updatedAt: Date;
    },
    blackouts: { id: string; date: Date; reason: string | null }[],
  ) {
    return {
      acceptingBookings: a.acceptingBookings,
      maxJobsPerDay: a.maxJobsPerDay,
      responseCommitment: a.responseCommitment,
      schedule: a.schedule,
      blackouts: blackouts.map((b) => this.serializeBlackout(b)),
      updatedAt: a.updatedAt,
    };
  }

  /**
   * Cheapest active service, used to derive the vendor's headline price. Prisma
   * batches this across a findMany, so it costs one extra query for a page of
   * vendors rather than one per vendor.
   */
  private static readonly CHEAPEST_SERVICE = {
    where: { active: true },
    orderBy: { priceNaira: 'asc' },
    take: 1,
  } as const;

  private serializeBlackout(b: { id: string; date: Date; reason: string | null }) {
    return {
      id: b.id,
      date: b.date.toISOString().slice(0, 10),
      reason: b.reason,
    };
  }

  // ─── Serializers ──────────────────────────────────────────────────────────

  private serializePublic(user: any) {
    const p = user.vendorProfile;
    // The posted service menu is the source of truth for what a buyer actually
    // pays — VendorProfile.priceLabel is free text that drifts and can't be
    // booked against. Derive the headline price from the cheapest active
    // service and only fall back to the profile field when there is no menu,
    // so the directory can't advertise a figure the profile contradicts.
    const cheapest = user.vendorServices?.[0];
    return {
      id: user.id,
      name: user.name,
      avatarUrl: user.avatarUrl,
      location: user.location,
      phone: user.phone,
      email: user.email,
      bio: user.bio,
      category: p?.serviceCategory ?? null,
      serviceArea: p?.serviceArea ?? null,
      yearsExperience: p?.yearsExperience ?? null,
      priceLabel: cheapest
        ? `From ₦${cheapest.priceNaira.toLocaleString('en-NG')}`
        : (p?.priceLabel ?? null),
      priceNum: cheapest ? cheapest.priceNaira : (p?.priceNum ?? null),
      bannerImage: p?.bannerImage ?? null,
      portfolioImages: p?.portfolioImages ?? [],
      availableForHire: p?.availableForHire ?? true,
      rating: p?.rating ?? 0,
      jobsCount: p?.jobsCount ?? 0,
      verified: p?.verified ?? false,
      createdAt: user.createdAt,
    };
  }

  private serializePrivate(user: any) {
    return {
      ...this.serializePublic(user),
      settings: user.settings,
    };
  }
}
