import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ListingStatus, Role } from '../../generated/prisma/client';

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

    const activeListings = await this.prisma.listing.count({
      where: { status: 'ACTIVE' },
    });

    return {
      totalUsers,
      totalAgents,
      totalVendors,
      totalListings,
      activeListings,
      totalOrders,
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

  async listOrders(options: {
    page: number;
    limit: number;
    status?: string;
  }) {
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

  async listDisputes(options: {
    page: number;
    limit: number;
    status?: string;
  }) {
    const { page, limit, status } = options;
    const skip = (page - 1) * limit;

    const where: any = {
      comment: { not: null },
    };

    const [items, total] = await Promise.all([
      this.prisma.vendorReview.findMany({
        where,
        select: {
          id: true,
          clientName: true,
          rating: true,
          comment: true,
          createdAt: true,
          vendor: {
            select: { name: true },
          },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.vendorReview.count({ where }),
    ]);

    return {
      items: items.map((item: any) => ({
        id: item.id,
        title: `Review: "${item.comment?.substring(0, 50)}..."`,
        status: item.rating < 3 ? 'open' : 'closed',
        severity: item.rating < 3 ? 'high' : item.rating < 4 ? 'medium' : 'low',
        createdAt: item.createdAt,
        reportedBy: { name: item.clientName },
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

  // ─── Agents ──────────────────────────────────────────────────────────────

  async listAgents(options: { page: number; limit: number; search?: string; verified?: boolean }) {
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

  // ─── Vendors ─────────────────────────────────────────────────────────────

  async listVendors(options: { page: number; limit: number; search?: string; verified?: boolean }) {
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
      data: { isActive },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
      },
    });
  }
}
