import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  ListingStatus,
  Prisma,
  Role,
} from '../../generated/prisma/client';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { ListListingsDto } from './dto/list-listings.dto';
import { AddListingDocumentDto } from './dto/add-document.dto';

@Injectable()
export class ListingsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Public listing & search ─────────────────────────────────────────────

  async list(dto: ListListingsDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 24;
    const skip = (page - 1) * limit;

    const where: Prisma.ListingWhereInput = {
      status: dto.status ?? ListingStatus.ACTIVE,
    };

    if (dto.type) where.type = dto.type;
    if (dto.propertyType) where.propertyType = { equals: dto.propertyType, mode: 'insensitive' };
    if (dto.location) where.location = { contains: dto.location, mode: 'insensitive' };
    if (dto.minBeds != null) where.beds = { gte: Number(dto.minBeds) };
    if (dto.minBaths != null) where.baths = { gte: Number(dto.minBaths) };
    if (dto.minPrice != null || dto.maxPrice != null) {
      where.priceNaira = {
        ...(dto.minPrice != null && { gte: Number(dto.minPrice) }),
        ...(dto.maxPrice != null && { lte: Number(dto.maxPrice) }),
      };
    }
    if (dto.search) {
      where.OR = [
        { title: { contains: dto.search, mode: 'insensitive' } },
        { address: { contains: dto.search, mode: 'insensitive' } },
        { location: { contains: dto.search, mode: 'insensitive' } },
        { description: { contains: dto.search, mode: 'insensitive' } },
      ];
    }

    let orderBy: Prisma.ListingOrderByWithRelationInput = { createdAt: 'desc' };
    switch (dto.sort) {
      case 'price_asc':
        orderBy = { priceNaira: 'asc' };
        break;
      case 'price_desc':
        orderBy = { priceNaira: 'desc' };
        break;
      case 'top_rated':
        orderBy = { rating: 'desc' };
        break;
      case 'newest':
      default:
        orderBy = { createdAt: 'desc' };
    }

    const [items, total] = await Promise.all([
      this.prisma.listing.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          agent: { include: { agentProfile: true } },
          documents: true,
        },
      }),
      this.prisma.listing.count({ where }),
    ]);

    return {
      items: items.map((l) => this.serialize(l)),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  async getById(id: string, opts: { incrementView?: boolean } = {}) {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      include: {
        agent: { include: { agentProfile: true } },
        documents: true,
      },
    });
    if (!listing) throw new NotFoundException('Listing not found');

    if (opts.incrementView && listing.status === ListingStatus.ACTIVE) {
      // Fire and forget — don't block response
      this.prisma.listing
        .update({
          where: { id },
          data: { viewsCount: { increment: 1 } },
        })
        .catch(() => undefined);
    }

    return this.serialize(listing);
  }

  async getBySlug(slug: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { slug },
      include: {
        agent: { include: { agentProfile: true } },
        documents: true,
      },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    return this.serialize(listing);
  }

  // ─── Agent-owned operations ──────────────────────────────────────────────

  async listMine(agentId: string, dto: ListListingsDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 24;
    const skip = (page - 1) * limit;

    const where: Prisma.ListingWhereInput = { agentId };
    if (dto.status) where.status = dto.status;
    if (dto.type) where.type = dto.type;
    if (dto.search) {
      where.OR = [
        { title: { contains: dto.search, mode: 'insensitive' } },
        { address: { contains: dto.search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.listing.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { documents: true },
      }),
      this.prisma.listing.count({ where }),
    ]);

    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async create(agentId: string, dto: CreateListingDto) {
    try {
      const agent = await this.prisma.user.findUnique({
        where: { id: agentId },
        include: { agentProfile: true },
      });
      if (!agent || agent.role !== Role.AGENT || !agent.agentProfile) {
        throw new ForbiddenException('Only agents can create listings');
      }

      const slug = await this.generateUniqueSlug(dto.title);
      const priceLabel = `₦${dto.priceNaira.toLocaleString('en-NG')}`;

      const listing = await this.prisma.listing.create({
        data: {
          agentId,
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
          sqft: dto.sqft,
          yearBuilt: dto.yearBuilt,
          description: dto.description,
          features: dto.features,
          coverImage: dto.coverImage,
          images: dto.images,
          virtualTourUrl: dto.virtualTourUrl,
          videoUrl: dto.videoUrl,
          status: ListingStatus.ACTIVE,
        },
        include: { documents: true },
      });

      // Best-effort counter bump. Don't kill the whole listing creation if
      // the agentProfile row is missing or this update otherwise blows up —
      // counters can be reconciled by scripts/sync-agent-counters.ts later.
      try {
        await this.prisma.agentProfile.update({
          where: { userId: agentId },
          data: { listingsCount: { increment: 1 } },
        });
      } catch (counterErr) {
        console.warn(
          `[listings.create] listingsCount increment failed for agent ${agentId}:`,
          counterErr,
        );
      }

      return listing;
    } catch (err: any) {
      // Surface as much detail as possible in Render logs. Keep the
      // ForbiddenException pass-through intact so the existing 403 still
      // bubbles up as a 403, not a 500.
      if (err instanceof ForbiddenException) throw err;
      console.error('[listings.create] failed', {
        agentId,
        title: dto?.title,
        type: dto?.type,
        propertyType: dto?.propertyType,
        coverImage: dto?.coverImage,
        imagesCount: dto?.images?.length,
        videoUrl: dto?.videoUrl,
        errCode: err?.code,
        errMessage: err?.message,
        errMeta: err?.meta,
        errName: err?.name,
        stack: err?.stack,
      });
      throw err;
    }
  }

  async update(agentId: string, listingId: string, dto: UpdateListingDto) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.agentId !== agentId) {
      throw new ForbiddenException('You can only edit your own listings');
    }

    const data: Prisma.ListingUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.propertyType !== undefined) data.propertyType = dto.propertyType;
    if (dto.priceNaira !== undefined) {
      data.priceNaira = dto.priceNaira;
      data.priceLabel = `₦${dto.priceNaira.toLocaleString('en-NG')}`;
      // Record price change if different. listing.priceNaira is BigInt and
      // dto.priceNaira is a plain Number — BigInt !== Number is always true,
      // so coerce both sides to Number before comparing.
      if (Number(listing.priceNaira) !== dto.priceNaira) {
        await this.prisma.listingPriceHistory.create({
          data: {
            listingId,
            oldPrice: listing.priceNaira,
            newPrice: dto.priceNaira,
          },
        });
      }
    }
    if (dto.period !== undefined) data.period = dto.period;
    if (dto.address !== undefined) data.address = dto.address;
    if (dto.location !== undefined) data.location = dto.location;
    if (dto.beds !== undefined) data.beds = dto.beds;
    if (dto.baths !== undefined) data.baths = dto.baths;
    if (dto.sqft !== undefined) data.sqft = dto.sqft;
    if (dto.yearBuilt !== undefined) data.yearBuilt = dto.yearBuilt;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.features !== undefined) data.features = dto.features;
    if (dto.coverImage !== undefined) data.coverImage = dto.coverImage;
    if (dto.images !== undefined) data.images = dto.images;
    if (dto.virtualTourUrl !== undefined) data.virtualTourUrl = dto.virtualTourUrl;
    if (dto.videoUrl !== undefined) data.videoUrl = dto.videoUrl;
    if (dto.status !== undefined) {
      data.status = dto.status;
      // If marked sold/rented, bump agent's deal counter
      if (
        (dto.status === ListingStatus.SOLD ||
          dto.status === ListingStatus.RENTED) &&
        listing.status !== dto.status
      ) {
        await this.prisma.agentProfile.update({
          where: { userId: agentId },
          data: { soldRentedCount: { increment: 1 } },
        });
      }
    }

    return this.prisma.listing.update({
      where: { id: listingId },
      data,
      include: { documents: true },
    });
  }

  async remove(agentId: string, listingId: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.agentId !== agentId) {
      throw new ForbiddenException('You can only delete your own listings');
    }

    await this.prisma.listing.delete({ where: { id: listingId } });
    await this.prisma.agentProfile.update({
      where: { userId: agentId },
      data: { listingsCount: { decrement: 1 } },
    });
    return { success: true };
  }

  // ─── Documents ────────────────────────────────────────────────────────────

  async addDocument(
    agentId: string,
    listingId: string,
    dto: AddListingDocumentDto,
  ) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.agentId !== agentId) {
      throw new ForbiddenException('You can only modify your own listings');
    }
    return this.prisma.listingDocument.create({
      data: {
        listingId,
        name: dto.name,
        type: dto.type,
        url: dto.url,
        date: dto.date ?? new Date().toLocaleDateString('en-NG', { month: 'short', year: 'numeric' }),
      },
    });
  }

  async removeDocument(agentId: string, listingId: string, docId: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.agentId !== agentId) {
      throw new ForbiddenException('You can only modify your own listings');
    }
    const doc = await this.prisma.listingDocument.findUnique({
      where: { id: docId },
    });
    if (!doc || doc.listingId !== listingId) {
      throw new NotFoundException('Document not found');
    }
    await this.prisma.listingDocument.delete({ where: { id: docId } });
    return { success: true };
  }

  // ─── Stats ────────────────────────────────────────────────────────────────

  async getStats(type: 'SALE' | 'RENT') {
    const where: Prisma.ListingWhereInput = {
      type,
      status: ListingStatus.ACTIVE,
    };

    // Get counts by property type
    const allListings = await this.prisma.listing.findMany({
      where,
      select: { propertyType: true, priceNaira: true },
    });

    // Count by type. priceNaira is BigInt — convert to Number for the
    // running total. Naira amounts are well within JS Number's safe-integer
    // range (2^53 ≈ ₦9 quadrillion), so the conversion is loss-free.
    const typeCounts: Record<string, number> = {};
    let totalPrice = 0;
    for (const listing of allListings) {
      typeCounts[listing.propertyType] = (typeCounts[listing.propertyType] ?? 0) + 1;
      totalPrice += Number(listing.priceNaira);
    }

    const total = allListings.length;
    const avgPrice = total > 0 ? Math.round(totalPrice / total) : 0;

    return {
      total,
      byType: typeCounts,
      avgPrice,
      newThisWeek: await this.prisma.listing.count({
        where: {
          ...where,
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      }),
      verifiedAgents: await this.prisma.agentProfile.count({
        where: { verified: true },
      }),
    };
  }

  // ─── Price History ────────────────────────────────────────────────────────

  async getPriceHistory(listingId: string) {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) throw new NotFoundException('Listing not found');
    return this.prisma.listingPriceHistory.findMany({
      where: { listingId },
      orderBy: { changedAt: 'desc' },
    });
  }

  // ─── Logbook for a listing ───────────────────────────────────────────────

  async getLogbookEntries(listingId: string) {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) throw new NotFoundException('Listing not found');
    return this.prisma.logbookEntry.findMany({
      where: { listingId },
      orderBy: { completedAt: 'desc' },
    });
  }

  async addLogbookEntry(
    agentId: string,
    listingId: string,
    dto: {
      category: string;
      title: string;
      description?: string;
      vendorName: string;
      vendorId?: string;
      cost: number;
      completedAt?: Date;
    },
  ) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.agentId !== agentId) {
      throw new ForbiddenException(
        'You can only add logbook entries to your own listings',
      );
    }
    return this.prisma.logbookEntry.create({
      data: {
        listingId,
        ownerUserId: agentId,
        category: dto.category,
        title: dto.title,
        description: dto.description,
        vendorName: dto.vendorName,
        vendorId: dto.vendorId,
        cost: dto.cost,
        completedAt: dto.completedAt ?? new Date(),
        verified: false,
      },
    });
  }

  async removeLogbookEntry(agentId: string, listingId: string, entryId: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.agentId !== agentId) {
      throw new ForbiddenException(
        'You can only modify your own listings',
      );
    }
    const entry = await this.prisma.logbookEntry.findUnique({
      where: { id: entryId },
    });
    if (!entry || entry.listingId !== listingId) {
      throw new NotFoundException('Logbook entry not found');
    }
    await this.prisma.logbookEntry.delete({ where: { id: entryId } });
    return { success: true };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async generateUniqueSlug(title: string): Promise<string> {
    const base = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    let slug = base;
    let i = 1;
    while (await this.prisma.listing.findUnique({ where: { slug } })) {
      i += 1;
      slug = `${base}-${i}`;
    }
    return slug;
  }

  private serialize(listing: any) {
    const agent = listing.agent;
    return {
      id: listing.id,
      slug: listing.slug,
      title: listing.title,
      type: listing.type,
      propertyType: listing.propertyType,
      // priceNaira is BigInt in the DB. Convert to Number for the JSON
      // wire — JSON.stringify can't serialise BigInt, and naira values
      // are always well within Number.MAX_SAFE_INTEGER (2^53).
      priceNaira: Number(listing.priceNaira),
      priceLabel: listing.priceLabel,
      period: listing.period,
      address: listing.address,
      location: listing.location,
      beds: listing.beds,
      baths: listing.baths,
      sqft: listing.sqft,
      yearBuilt: listing.yearBuilt,
      description: listing.description,
      features: listing.features,
      coverImage: listing.coverImage,
      images: listing.images,
      virtualTourUrl: listing.virtualTourUrl,
      videoUrl: listing.videoUrl,
      rating: listing.rating,
      verified: listing.verified,
      status: listing.status,
      viewsCount: listing.viewsCount,
      createdAt: listing.createdAt,
      updatedAt: listing.updatedAt,
      documents: listing.documents,
      agent: agent
        ? {
            id: agent.id,
            name: agent.name,
            avatarUrl: agent.avatarUrl,
            phone: agent.phone,
            email: agent.email,
            agency: agent.agentProfile?.agencyName ?? null,
            rating: agent.agentProfile?.rating ?? 0,
            listingsCount: agent.agentProfile?.listingsCount ?? 0,
            soldRentedCount: agent.agentProfile?.soldRentedCount ?? 0,
            verified: agent.agentProfile?.verified ?? false,
          }
        : null,
    };
  }
}
