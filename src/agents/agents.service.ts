import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  ListingStatus,
  Role,
} from '../../generated/prisma/client';
import { ListAgentsDto } from './dto/list-agents.dto';
import { UpdateAgentProfileDto } from './dto/update-agent-profile.dto';
import { CreateAgentReviewDto } from './dto/create-review.dto';

@Injectable()
export class AgentsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Public listing ──────────────────────────────────────────────────────

  async list(dto: ListAgentsDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 24;
    const skip = (page - 1) * limit;

    const where: any = {
      role: Role.AGENT,
      isActive: true,
      deletedAt: null,
      agentProfile: {
        is: {},
      },
    };

    if (dto.search) {
      where.OR = [
        { name: { contains: dto.search, mode: 'insensitive' } },
        { location: { contains: dto.search, mode: 'insensitive' } },
        { agentProfile: { is: { agencyName: { contains: dto.search, mode: 'insensitive' } } } },
      ];
    }

    if (dto.location) {
      where.location = { contains: dto.location, mode: 'insensitive' };
    }

    if (dto.specialty) {
      where.agentProfile = {
        is: {
          ...(dto.minRating != null && { rating: { gte: Number(dto.minRating) } }),
          specialty: { has: dto.specialty },
        },
      };
    } else if (dto.minRating != null) {
      where.agentProfile = {
        is: { rating: { gte: Number(dto.minRating) } },
      };
    }

    const orderBy: any[] = [];
    switch (dto.sort) {
      case 'most_listings':
        orderBy.push({ agentProfile: { listingsCount: 'desc' } });
        break;
      case 'most_deals':
        orderBy.push({ agentProfile: { soldRentedCount: 'desc' } });
        break;
      case 'top_performers':
        // Closed deals are the strongest signal of an effective agent.
        // Ties break on active listings (broad market presence), then on
        // creation date so the order is stable when both counters tie.
        orderBy.push(
          { agentProfile: { soldRentedCount: 'desc' } },
          { agentProfile: { listingsCount: 'desc' } },
          { createdAt: 'asc' },
        );
        break;
      case 'newest':
        orderBy.push({ createdAt: 'desc' });
        break;
      case 'top_rated':
      default:
        orderBy.push({ agentProfile: { rating: 'desc' } });
    }

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: { agentProfile: true },
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

  // ─── Public profile ──────────────────────────────────────────────────────

  async getPublicProfile(agentId: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        id: agentId,
        role: Role.AGENT,
        isActive: true,
        deletedAt: null,
      },
      include: {
        agentProfile: true,
      },
    });
    if (!user || !user.agentProfile) throw new NotFoundException('Agent not found');

    const [activeListings, reviews] = await Promise.all([
      this.prisma.listing.findMany({
        where: { agentId: user.id, status: ListingStatus.ACTIVE },
        orderBy: { createdAt: 'desc' },
        take: 12,
      }),
      this.prisma.agentReview.findMany({
        where: { agentUserId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    return {
      ...this.serializePublic(user),
      bio: user.bio,
      activeListings,
      reviews,
    };
  }

  // ─── Authenticated agent: own profile + dashboard stats ──────────────────

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { agentProfile: true, settings: true },
    });
    if (!user || user.role !== Role.AGENT || !user.agentProfile) {
      throw new ForbiddenException('Agent profile not found');
    }
    return this.serializePrivate(user);
  }

  async updateMe(userId: string, dto: UpdateAgentProfileDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { agentProfile: true },
    });
    if (!user || user.role !== Role.AGENT || !user.agentProfile) {
      throw new ForbiddenException('Agent profile not found');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.location !== undefined && { location: dto.location }),
        ...(dto.bio !== undefined && { bio: dto.bio }),
        ...(dto.avatarUrl !== undefined && { avatarUrl: dto.avatarUrl }),
        agentProfile: {
          update: {
            ...(dto.agencyName !== undefined && { agencyName: dto.agencyName }),
            ...(dto.businessAddress !== undefined && { businessAddress: dto.businessAddress }),
            ...(dto.yearsExperience !== undefined && { yearsExperience: dto.yearsExperience }),
            ...(dto.specialty !== undefined && { specialty: dto.specialty }),
            ...(dto.website !== undefined && { website: dto.website }),
          },
        },
      },
      include: { agentProfile: true, settings: true },
    });

    return this.serializePrivate(updated);
  }

  async getStats(userId: string) {
    const profile = await this.prisma.agentProfile.findUnique({
      where: { userId },
    });
    if (!profile) throw new ForbiddenException('Agent profile not found');

    const [
      totalListings,
      activeListings,
      pendingListings,
      totalLeads,
      newLeads,
      convertedLeads,
      totalViewings,
      upcomingViewings,
      totalViewsAgg,
    ] = await Promise.all([
      this.prisma.listing.count({ where: { agentId: userId } }),
      this.prisma.listing.count({
        where: { agentId: userId, status: ListingStatus.ACTIVE },
      }),
      this.prisma.listing.count({
        where: { agentId: userId, status: ListingStatus.PENDING_REVIEW },
      }),
      this.prisma.lead.count({ where: { agentId: userId } }),
      this.prisma.lead.count({ where: { agentId: userId, status: 'NEW' } }),
      this.prisma.lead.count({
        where: { agentId: userId, status: 'CONVERTED' },
      }),
      this.prisma.viewing.count({ where: { agentId: userId } }),
      this.prisma.viewing.count({
        where: {
          agentId: userId,
          scheduledFor: { gte: new Date() },
          status: { in: ['PENDING', 'CONFIRMED'] },
        },
      }),
      this.prisma.listing.aggregate({
        where: { agentId: userId },
        _sum: { viewsCount: true },
      }),
    ]);

    const conversionRate = totalLeads === 0 ? 0 : Math.round((convertedLeads / totalLeads) * 100);

    return {
      profile: {
        rating: profile.rating,
        listingsCount: profile.listingsCount,
        soldRentedCount: profile.soldRentedCount,
        verified: profile.verified,
        yearsExperience: profile.yearsExperience,
      },
      listings: {
        total: totalListings,
        active: activeListings,
        pendingReview: pendingListings,
        totalViews: totalViewsAgg._sum.viewsCount ?? 0,
      },
      leads: {
        total: totalLeads,
        new: newLeads,
        converted: convertedLeads,
        conversionRate,
      },
      viewings: {
        total: totalViewings,
        upcoming: upcomingViewings,
      },
    };
  }

  // ─── Reviews ──────────────────────────────────────────────────────────────

  async listReviews(agentId: string) {
    const agent = await this.prisma.user.findFirst({
      where: { id: agentId, role: Role.AGENT, deletedAt: null },
      select: { id: true },
    });
    if (!agent) throw new NotFoundException('Agent not found');
    return this.prisma.agentReview.findMany({
      where: { agentUserId: agentId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createReview(
    agentId: string,
    dto: CreateAgentReviewDto,
    reviewerUserId?: string,
  ) {
    const agent = await this.prisma.user.findFirst({
      where: { id: agentId, role: Role.AGENT, deletedAt: null },
      include: { agentProfile: true },
    });
    if (!agent || !agent.agentProfile) throw new NotFoundException('Agent not found');

    let reviewerName = dto.reviewerName?.trim();
    if (reviewerUserId) {
      const reviewer = await this.prisma.user.findUnique({
        where: { id: reviewerUserId },
        select: { name: true },
      });
      reviewerName = reviewer?.name || reviewerName || 'Anonymous';
    }
    if (!reviewerName) reviewerName = 'Anonymous';

    const review = await this.prisma.agentReview.create({
      data: {
        agentUserId: agentId,
        reviewerUserId: reviewerUserId,
        reviewerName,
        rating: dto.rating,
        comment: dto.comment,
      },
    });

    // Recompute the agent's average rating
    const agg = await this.prisma.agentReview.aggregate({
      where: { agentUserId: agentId },
      _avg: { rating: true },
      _count: { rating: true },
    });
    await this.prisma.agentProfile.update({
      where: { userId: agentId },
      data: { rating: Number((agg._avg.rating ?? 0).toFixed(2)) },
    });

    return review;
  }

  // ─── Serializers ──────────────────────────────────────────────────────────

  private serializePublic(user: any) {
    const p = user.agentProfile;
    return {
      id: user.id,
      name: user.name,
      avatarUrl: user.avatarUrl,
      location: user.location,
      phone: user.phone,
      email: user.email,
      bio: user.bio,
      agency: p?.agencyName ?? null,
      yearsExperience: p?.yearsExperience ?? 0,
      specialty: p?.specialty ?? [],
      website: p?.website ?? null,
      rating: p?.rating ?? 0,
      listingsCount: p?.listingsCount ?? 0,
      soldRentedCount: p?.soldRentedCount ?? 0,
      verified: p?.verified ?? false,
      createdAt: user.createdAt,
    };
  }

  private serializePrivate(user: any) {
    return {
      ...this.serializePublic(user),
      // Sensitive fields visible only to the owner
      licenseNumber: user.agentProfile?.licenseNumber,
      businessAddress: user.agentProfile?.businessAddress,
      settings: user.settings,
    };
  }
}
