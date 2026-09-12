import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { cleanDescription } from '../common/utils/sanitize';
import { PrismaService } from '../prisma/prisma.service';
import {
  ListingOwnership,
  ListingStatus,
  Role,
  SubscriptionTier,
  SubscriptionStatus,
  Prisma,
} from '../../generated/prisma/client';
import { UpdateListingDto } from '../listings/dto/update-listing.dto';
import { AdminCreateListingDto } from '../listings/dto/admin-create-listing.dto';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview() {
    const [totalUsers, totalAgents, totalVendors, totalListings, totalOrders] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.user.count({ where: { role: Role.AGENT } }),
        this.prisma.user.count({ where: { role: Role.VENDOR } }),
        this.prisma.listing.count(),
        this.prisma.order.count(),
      ]);

    const [activeListings, pendingWithdrawals] = await Promise.all([
      this.prisma.listing.count({ where: { status: 'ACTIVE' } }),
      // Manual payouts an admin still needs to transfer + settle.
      this.prisma.withdrawalRequest.count({ where: { status: 'PENDING' } }),
    ]);

    return {
      totalUsers,
      totalAgents,
      totalVendors,
      totalListings,
      activeListings,
      totalOrders,
      pendingWithdrawals,
    };
  }

  async listUsers(options: { page: number; limit: number; search?: string }) {
    const { page, limit, search } = options;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          isActive: true,
          createdAt: true,
          agentProfile: {
            select: { verified: true },
          },
          vendorProfile: {
            select: { verified: true },
          },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  /**
   * Referral leaderboard for the admin panel: every user with how many
   * signups their personal link brought in (plus who referred *them*), so
   * rewards can be paid out per referrer. Sorted by referral count.
   */
  async listReferrals(options: {
    page: number;
    limit: number;
    search?: string;
  }) {
    const { page, limit, search } = options;
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = { deletedAt: null };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { referralCode: { equals: search.trim().toUpperCase() } },
      ];
    }

    const [items, total, totalReferredSignups] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          referralCode: true,
          createdAt: true,
          referredBy: { select: { id: true, name: true, email: true } },
          _count: { select: { referrals: true } },
        },
        skip,
        take: limit,
        orderBy: [{ referrals: { _count: 'desc' } }, { createdAt: 'desc' }],
      }),
      this.prisma.user.count({ where }),
      this.prisma.user.count({
        where: { referredById: { not: null }, deletedAt: null },
      }),
    ]);

    return {
      items: items.map(({ _count, ...u }) => ({
        ...u,
        referralCount: _count.referrals,
      })),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
      totalReferredSignups,
    };
  }

  /** Everyone a given user referred — the admin drill-down for one referrer. */
  async listUserReferrals(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, referralCode: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const referrals = await this.prisma.user.findMany({
      where: { referredById: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        isActive: true,
        deletedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return { user, totalReferrals: referrals.length, referrals };
  }

  async listOrders(options: { page: number; limit: number; status?: string }) {
    const { page, limit, status } = options;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (status) {
      where.payMethod = status;
    }

    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        select: {
          id: true,
          orderNumber: true,
          total: true,
          payMethod: true,
          placedAt: true,
          user: {
            select: { name: true, email: true },
          },
          items: {
            select: { id: true, name: true, quantity: true },
          },
        },
        skip,
        take: limit,
        orderBy: { placedAt: 'desc' },
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      items: items.map((o: any) => ({
        ...o,
        status: o.payMethod,
        amount: o.total,
        buyer: o.user,
      })),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  // ─── Listings (admin moderation) ─────────────────────────────────────────

  async listListings(options: {
    page: number;
    limit: number;
    status?: ListingStatus;
    search?: string;
  }) {
    const { page, limit, status, search } = options;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { address: { contains: search, mode: 'insensitive' } },
        { location: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.listing.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          agent: {
            select: {
              id: true,
              name: true,
              email: true,
              avatarUrl: true,
              agentProfile: { select: { agencyName: true, verified: true } },
            },
          },
        },
      }),
      this.prisma.listing.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  async setListingStatus(listingId: string, status: ListingStatus) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    return this.prisma.listing.update({
      where: { id: listingId },
      data: { status },
    });
  }

  /**
   * Create a listing on behalf of an agent. Unlike the agent-facing
   * `ListingsService.create`, this is an admin override: it does NOT gate on
   * the agent's subscription status or the STANDARD active-listing cap, and it
   * lets the admin set the initial status directly (defaults to PENDING_REVIEW
   * so the listing still goes through the normal verification flow).
   */
  async adminCreateListing(dto: AdminCreateListingDto) {
    const agent = await this.prisma.user.findUnique({
      where: { id: dto.agentId },
      include: { agentProfile: true },
    });
    if (!agent) {
      throw new NotFoundException('Agent not found');
    }
    if (agent.role !== Role.AGENT || !agent.agentProfile) {
      throw new BadRequestException(
        'Listings can only be assigned to an agent account.',
      );
    }

    const slug = await this.generateUniqueListingSlug(dto.title);
    const priceLabel = `₦${dto.priceNaira.toLocaleString('en-NG')}`;

    const listing = await this.prisma.listing.create({
      data: {
        agentId: dto.agentId,
        // Anything staff post from the team portal is PropertyLoop's own
        // stock, which is the inventory agent partners are given to sell.
        // Set here rather than accepted from the request — an agent must not
        // be able to label their own listing as ours.
        ownership: ListingOwnership.HOUSE,
        // Who brought it in, as distinct from who owns it. This is the field
        // that makes each staff member's acquisition figure a fact rather
        // than a claim.
        sourcedByStaffId: dto.sourcedByStaffId ?? null,
        fromDealId: dto.fromDealId ?? null,
        title: dto.title,
        slug,
        type: dto.type,
        propertyType: dto.propertyType,
        priceNaira: dto.priceNaira,
        priceLabel,
        period: dto.period,
        address: dto.address,
        location: dto.location,
        beds: dto.beds,
        baths: dto.baths,
        // sqft is optional on input but the column is required — default to
        // an empty string when size is left blank.
        sqft: dto.sqft ?? '',
        yearBuilt: dto.yearBuilt,
        description: cleanDescription(dto.description),
        features: dto.features,
        coverImage: dto.coverImage,
        images: dto.images,
        virtualTourUrl: dto.virtualTourUrl,
        videoUrl: dto.videoUrl,
        videoUrls: dto.videoUrls ?? [],
        status: dto.status ?? ListingStatus.PENDING_REVIEW,
      },
      include: { agent: { include: { agentProfile: true } }, documents: true },
    });

    // Best-effort counter bump — mirror ListingsService.create. Don't fail the
    // whole creation if the counter update blows up; it can be reconciled.
    try {
      await this.prisma.agentProfile.update({
        where: { userId: dto.agentId },
        data: { listingsCount: { increment: 1 } },
      });
    } catch (counterErr) {
      console.warn(
        `[admin.adminCreateListing] listingsCount increment failed for agent ${dto.agentId}:`,
        counterErr,
      );
    }

    return listing;
  }

  private async generateUniqueListingSlug(title: string): Promise<string> {
    const base = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    let slug = base || 'listing';
    let i = 1;
    while (await this.prisma.listing.findUnique({ where: { slug } })) {
      i += 1;
      slug = `${base}-${i}`;
    }
    return slug;
  }

  async adminUpdateListing(listingId: string, dto: UpdateListingDto) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      include: { agent: { include: { agentProfile: true } }, documents: true },
    });
    if (!listing) throw new NotFoundException('Listing not found');

    const data: Prisma.ListingUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.propertyType !== undefined) data.propertyType = dto.propertyType;
    if (dto.priceNaira !== undefined) {
      data.priceNaira = dto.priceNaira;
      data.priceLabel = `₦${dto.priceNaira.toLocaleString('en-NG')}`;
    }
    if (dto.period !== undefined) data.period = dto.period;
    if (dto.address !== undefined) data.address = dto.address;
    if (dto.location !== undefined) data.location = dto.location;
    if (dto.beds !== undefined) data.beds = dto.beds;
    if (dto.baths !== undefined) data.baths = dto.baths;
    if (dto.sqft !== undefined) data.sqft = dto.sqft;
    if (dto.yearBuilt !== undefined) data.yearBuilt = dto.yearBuilt;
    if (dto.description !== undefined)
      data.description = cleanDescription(dto.description);
    if (dto.features !== undefined) data.features = dto.features;
    if (dto.coverImage !== undefined) data.coverImage = dto.coverImage;
    if (dto.images !== undefined) data.images = dto.images;
    if (dto.virtualTourUrl !== undefined)
      data.virtualTourUrl = dto.virtualTourUrl;
    if (dto.videoUrl !== undefined) data.videoUrl = dto.videoUrl;
    if (dto.status !== undefined) data.status = dto.status;

    const updated = await this.prisma.listing.update({
      where: { id: listingId },
      data,
      include: { agent: { include: { agentProfile: true } }, documents: true },
    });
    return updated;
  }

  // ─── Agents ──────────────────────────────────────────────────────────────

  async listAgents(options: {
    page: number;
    limit: number;
    search?: string;
    verified?: boolean;
  }) {
    const { page, limit, search, verified } = options;
    const skip = (page - 1) * limit;

    const where: any = { role: Role.AGENT };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (verified !== undefined) {
      where.agentProfile = { verified };
    }

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          avatarUrl: true,
          isActive: true,
          createdAt: true,
          agentProfile: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async setAgentVerified(userId: string, verified: boolean) {
    const profile = await this.prisma.agentProfile.findUnique({
      where: { userId },
    });
    if (!profile) throw new NotFoundException('Agent profile not found');
    return this.prisma.agentProfile.update({
      where: { userId },
      data: { verified },
    });
  }

  async overrideAgentSubscription(
    userId: string,
    tier: SubscriptionTier,
    status: SubscriptionStatus,
  ) {
    const profile = await this.prisma.agentProfile.findUnique({
      where: { userId },
    });
    if (!profile) throw new NotFoundException('Agent profile not found');

    const updated = await this.prisma.agentProfile.update({
      where: { userId },
      data: { subscriptionTier: tier, subscriptionStatus: status },
    });

    // If setting to LAPSED, pause all their active listings
    if (status === SubscriptionStatus.LAPSED) {
      await this.prisma.listing.updateMany({
        where: { agentId: userId, status: ListingStatus.ACTIVE },
        data: { status: ListingStatus.PAUSED },
      });
    }

    // If setting back to ACTIVE, restore paused listings
    if (status === SubscriptionStatus.ACTIVE) {
      await this.prisma.listing.updateMany({
        where: { agentId: userId, status: ListingStatus.PAUSED },
        data: { status: ListingStatus.ACTIVE },
      });
    }

    return updated;
  }

  // ─── Vendors ─────────────────────────────────────────────────────────────

  async listVendors(options: {
    page: number;
    limit: number;
    search?: string;
    verified?: boolean;
  }) {
    const { page, limit, search, verified } = options;
    const skip = (page - 1) * limit;

    const where: any = { role: Role.VENDOR };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (verified !== undefined) {
      where.vendorProfile = { verified };
    }

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          avatarUrl: true,
          isActive: true,
          createdAt: true,
          vendorProfile: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async setVendorVerified(userId: string, verified: boolean) {
    const profile = await this.prisma.vendorProfile.findUnique({
      where: { userId },
    });
    if (!profile) throw new NotFoundException('Vendor profile not found');
    return this.prisma.vendorProfile.update({
      where: { userId },
      data: { verified },
    });
  }

  // ─── Users ───────────────────────────────────────────────────────────────

  async setUserActive(userId: string, isActive: boolean) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === Role.ADMIN && !isActive) {
      throw new BadRequestException('Cannot suspend an admin account');
    }
    return this.prisma.user.update({
      where: { id: userId },
      // Admin reactivation also clears a self-deactivation flag if present —
      // otherwise the user would stay tagged as "self-deactivated" despite an
      // admin having already restored them.
      data: { isActive, ...(isActive && { deactivatedAt: null }) },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
      },
    });
  }

  /**
   * Force-logs a user out of every device by revoking all their refresh
   * tokens and sessions. Their in-memory access token keeps working until it
   * expires (≤15 min), after which the silent refresh fails and the client
   * redirects to /login.
   */
  async forceLogoutUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const now = new Date();
    const [tokens, sessions] = await Promise.all([
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);
    return { revokedTokens: tokens.count, revokedSessions: sessions.count };
  }

  /**
   * Site-wide force logout: revokes every active refresh token and session,
   * except the acting admin's — so the admin doing the reset isn't kicked
   * out of their own panel mid-action.
   */
  async forceLogoutEveryone(exceptUserId: string) {
    const now = new Date();
    const [tokens, sessions] = await Promise.all([
      this.prisma.refreshToken.updateMany({
        where: { revokedAt: null, userId: { not: exceptUserId } },
        data: { revokedAt: now },
      }),
      this.prisma.session.updateMany({
        where: { revokedAt: null, userId: { not: exceptUserId } },
        data: { revokedAt: now },
      }),
    ]);
    return { revokedTokens: tokens.count, revokedSessions: sessions.count };
  }
}
