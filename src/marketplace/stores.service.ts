import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertStoreDto } from './dto/upsert-store.dto';

@Injectable()
export class MarketplaceStoresService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Public ───────────────────────────────────────────────────────────────

  /** Active stores, newest first, with a product count for the hub cards. */
  async listPublic() {
    const stores = await this.prisma.marketplaceStore.findMany({
      where: { active: true },
      orderBy: [{ verified: 'desc' }, { ordersFulfilled: 'desc' }, { createdAt: 'desc' }],
      include: { _count: { select: { products: { where: { active: true } } } } },
    });
    return stores.map((s) => this.serializeCard(s));
  }

  /** One store by slug, with its active products — the storefront page payload. */
  async getBySlugPublic(slug: string) {
    const store = await this.prisma.marketplaceStore.findUnique({
      where: { slug },
      include: {
        products: {
          where: { active: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!store || !store.active) throw new NotFoundException('Store not found');
    return this.serializeFull(store);
  }

  // ─── Vendor ─────────────────────────────────────────────────────────────

  async getMyStore(ownerUserId: string) {
    const store = await this.prisma.marketplaceStore.findFirst({
      where: { ownerUserId },
      include: { _count: { select: { products: true } } },
    });
    return store ? this.serializeFull(store) : null;
  }

  /**
   * Create or update the authenticated vendor's single store. A vendor can only
   * ever have one storefront, so this upserts on ownerUserId. commissionPct /
   * verified are ignored here — only an admin controls those.
   */
  async upsertMyStore(ownerUserId: string, dto: UpsertStoreDto) {
    const existing = await this.prisma.marketplaceStore.findFirst({
      where: { ownerUserId },
    });

    const data = {
      name: dto.name,
      tagline: dto.tagline,
      bio: dto.bio,
      logo: dto.logo,
      banner: dto.banner,
      accent: dto.accent ?? undefined,
      category: dto.category,
      location: dto.location,
      phone: dto.phone,
      email: dto.email,
      established: dto.established ?? undefined,
      responseTime: dto.responseTime ?? undefined,
      deliveryAreas: dto.deliveryAreas ?? undefined,
      policies: (dto.policies as object) ?? undefined,
      promo: (dto.promo as object) ?? undefined,
      collections: (dto.collections as object) ?? undefined,
    };

    if (existing) {
      const updated = await this.prisma.marketplaceStore.update({
        where: { id: existing.id },
        data,
      });
      return this.serializeFull(updated);
    }

    const slug = await this.generateUniqueSlug(dto.name);
    const created = await this.prisma.marketplaceStore.create({
      data: {
        ownerUserId,
        slug,
        ...data,
        // Lists are required on create (no DB default); fall back to empty.
        deliveryAreas: dto.deliveryAreas ?? [],
        policies: (dto.policies as object) ?? [],
        collections: (dto.collections as object) ?? [],
      },
    });
    return this.serializeFull(created);
  }

  // ─── Admin ────────────────────────────────────────────────────────────────

  /** Admin can set commission, verification and active state on any store. */
  async adminUpdate(storeId: string, dto: UpsertStoreDto) {
    const store = await this.prisma.marketplaceStore.findUnique({
      where: { id: storeId },
    });
    if (!store) throw new NotFoundException('Store not found');

    const updated = await this.prisma.marketplaceStore.update({
      where: { id: storeId },
      data: {
        commissionPct: dto.commissionPct ?? undefined,
        verified: dto.verified ?? undefined,
        active: dto.active ?? undefined,
      },
    });
    return this.serializeFull(updated);
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  /** Resolve the authenticated vendor's store id, or throw a helpful 400. */
  async requireStoreId(ownerUserId: string): Promise<string> {
    const store = await this.prisma.marketplaceStore.findFirst({
      where: { ownerUserId },
      select: { id: true },
    });
    if (!store) {
      throw new BadRequestException(
        'Set up your storefront before adding products.',
      );
    }
    return store.id;
  }

  private async generateUniqueSlug(name: string): Promise<string> {
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'store';
    let slug = base;
    let i = 1;
    while (
      await this.prisma.marketplaceStore.findUnique({ where: { slug } })
    ) {
      i += 1;
      slug = `${base}-${i}`;
    }
    return slug;
  }

  private serializeCard(store: any) {
    return {
      slug: store.slug,
      name: store.name,
      tagline: store.tagline,
      category: store.category,
      logo: store.logo,
      banner: store.banner,
      accent: store.accent,
      rating: store.rating,
      productsCount: store._count?.products ?? 0,
      verified: store.verified,
      live: true,
    };
  }

  private serializeFull(store: any) {
    return {
      id: store.id,
      ownerUserId: store.ownerUserId,
      slug: store.slug,
      name: store.name,
      tagline: store.tagline,
      bio: store.bio,
      logo: store.logo,
      banner: store.banner,
      accent: store.accent,
      category: store.category,
      location: store.location,
      phone: store.phone,
      email: store.email,
      established: store.established,
      commissionPct: store.commissionPct,
      verified: store.verified,
      active: store.active,
      rating: store.rating,
      reviews: store.reviewsCount,
      ordersFulfilled: store.ordersFulfilled,
      responseTime: store.responseTime,
      deliveryAreas: store.deliveryAreas,
      policies: store.policies,
      promo: store.promo,
      collections: store.collections,
      productsCount: store._count?.products,
      products: Array.isArray(store.products)
        ? store.products.map((p: any) => serializeProduct(p, store))
        : undefined,
    };
  }
}

/**
 * Shared product serializer — shapes a DB row into the storefront's StoreProduct.
 * Exported so ProductsService returns an identical shape.
 */
export function serializeProduct(p: any, store?: any) {
  return {
    id: p.id,
    storeSlug: store?.slug ?? p.store?.slug,
    storeName: store?.name ?? p.store?.name,
    storeAccent: store?.accent ?? p.store?.accent,
    slug: p.slug,
    name: p.name,
    description: p.description,
    priceNaira: p.priceNaira,
    compareAtNaira: p.compareAtNaira ?? undefined,
    image: p.coverImage,
    gallery: p.gallery,
    category: p.category,
    specs: p.specs,
    options: p.options,
    tag: p.tag ?? undefined,
    bulkEligible: p.bulkEligible,
    rating: p.rating,
    reviews: p.reviewsCount,
    inStock: p.inStock,
    stockQty: p.stockQty ?? undefined,
  };
}
