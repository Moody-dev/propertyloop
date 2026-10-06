import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { ListMarketplaceProductsDto } from './dto/list-products.dto';
import { CreateProductDto, UpdateProductDto } from './dto/upsert-product.dto';
import { serializeProduct } from './stores.service';

@Injectable()
export class MarketplaceProductsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Public ───────────────────────────────────────────────────────────────

  async listPublic(dto: ListMarketplaceProductsDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 24;
    const skip = (page - 1) * limit;

    const where: Prisma.MarketplaceProductWhereInput = {
      active: true,
      store: { active: true },
    };
    if (dto.category)
      where.category = { equals: dto.category, mode: 'insensitive' };
    if (dto.storeSlug) where.store = { slug: dto.storeSlug, active: true };
    if (dto.search) {
      where.OR = [
        { name: { contains: dto.search, mode: 'insensitive' } },
        { category: { contains: dto.search, mode: 'insensitive' } },
        { store: { name: { contains: dto.search, mode: 'insensitive' } } },
      ];
    }

    let orderBy: Prisma.MarketplaceProductOrderByWithRelationInput = {
      createdAt: 'desc',
    };
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
      case 'popular':
        orderBy = { reviewsCount: 'desc' };
        break;
    }

    const [items, total] = await Promise.all([
      this.prisma.marketplaceProduct.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: { store: true },
      }),
      this.prisma.marketplaceProduct.count({ where }),
    ]);

    return {
      items: items.map((p) => serializeProduct(p)),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  /** Product detail + up to four sibling products from the same store. */
  async getByIdPublic(id: string) {
    const product = await this.prisma.marketplaceProduct.findUnique({
      where: { id },
      include: { store: true },
    });
    if (!product || !product.active || !product.store.active) {
      throw new NotFoundException('Product not found');
    }

    const related = await this.prisma.marketplaceProduct.findMany({
      where: {
        storeId: product.storeId,
        active: true,
        id: { not: product.id },
      },
      orderBy: { createdAt: 'desc' },
      take: 4,
      include: { store: true },
    });

    return {
      ...serializeProduct(product),
      store: {
        slug: product.store.slug,
        name: product.store.name,
        logo: product.store.logo,
        accent: product.store.accent,
        category: product.store.category,
        verified: product.store.verified,
        ordersFulfilled: product.store.ordersFulfilled,
        policies: product.store.policies,
        promo: product.store.promo,
      },
      related: related.map((p) => serializeProduct(p)),
    };
  }

  // ─── Vendor CRUD ──────────────────────────────────────────────────────────

  async listForStore(storeId: string) {
    const products = await this.prisma.marketplaceProduct.findMany({
      where: { storeId },
      orderBy: { createdAt: 'desc' },
      include: { store: true },
    });
    return products.map((p) => serializeProduct(p));
  }

  async create(storeId: string, dto: CreateProductDto) {
    const slug = await this.generateUniqueSlug(dto.name);
    const product = await this.prisma.marketplaceProduct.create({
      data: {
        storeId,
        slug,
        name: dto.name,
        description: dto.description,
        priceNaira: dto.priceNaira,
        compareAtNaira: dto.compareAtNaira ?? null,
        category: dto.category,
        coverImage: dto.coverImage,
        gallery: dto.gallery ?? [],
        specs: (dto.specs as object) ?? [],
        options: (dto.options as object) ?? [],
        tag: dto.tag ?? null,
        bulkEligible: dto.bulkEligible ?? false,
        inStock: dto.inStock ?? true,
        stockQty: dto.stockQty ?? null,
        active: dto.active ?? true,
      },
      include: { store: true },
    });
    return serializeProduct(product);
  }

  async update(storeId: string, productId: string, dto: UpdateProductDto) {
    await this.assertOwned(storeId, productId);
    const product = await this.prisma.marketplaceProduct.update({
      where: { id: productId },
      data: {
        name: dto.name ?? undefined,
        description: dto.description ?? undefined,
        priceNaira: dto.priceNaira ?? undefined,
        compareAtNaira:
          dto.compareAtNaira === undefined ? undefined : dto.compareAtNaira,
        category: dto.category ?? undefined,
        coverImage: dto.coverImage ?? undefined,
        gallery: dto.gallery ?? undefined,
        specs: dto.specs === undefined ? undefined : (dto.specs as object),
        options:
          dto.options === undefined ? undefined : (dto.options as object),
        tag: dto.tag === undefined ? undefined : dto.tag,
        bulkEligible: dto.bulkEligible ?? undefined,
        inStock: dto.inStock ?? undefined,
        stockQty: dto.stockQty === undefined ? undefined : dto.stockQty,
        active: dto.active ?? undefined,
      },
      include: { store: true },
    });
    return serializeProduct(product);
  }

  /**
   * Soft delete — flip active off so historical order items (which reference the
   * product with ON DELETE RESTRICT) keep resolving. Hard delete would fail once
   * the product has ever been ordered.
   */
  async remove(storeId: string, productId: string) {
    await this.assertOwned(storeId, productId);
    await this.prisma.marketplaceProduct.update({
      where: { id: productId },
      data: { active: false },
    });
    return { success: true };
  }

  private async assertOwned(storeId: string, productId: string) {
    const product = await this.prisma.marketplaceProduct.findUnique({
      where: { id: productId },
      select: { storeId: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    if (product.storeId !== storeId) {
      throw new ForbiddenException('That product belongs to another store');
    }
  }

  private async generateUniqueSlug(name: string): Promise<string> {
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'product';
    let slug = base;
    let i = 1;
    while (
      await this.prisma.marketplaceProduct.findUnique({ where: { slug } })
    ) {
      i += 1;
      slug = `${base}-${i}`;
    }
    return slug;
  }
}
