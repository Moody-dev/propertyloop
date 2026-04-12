import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { ListProductsDto } from './dto/list-products.dto';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(dto: ListProductsDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 24;
    const skip = (page - 1) * limit;

    const where: Prisma.ProductWhereInput = {};

    if (dto.category) where.category = { equals: dto.category, mode: 'insensitive' };
    if (dto.location) where.location = { contains: dto.location, mode: 'insensitive' };
    if (dto.search) {
      where.OR = [
        { name: { contains: dto.search, mode: 'insensitive' } },
        { supplier: { contains: dto.search, mode: 'insensitive' } },
        { category: { contains: dto.search, mode: 'insensitive' } },
      ];
    }

    let orderBy: Prisma.ProductOrderByWithRelationInput = { createdAt: 'desc' };
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
    }

    const [items, total] = await Promise.all([
      this.prisma.product.findMany({ where, orderBy, skip, take: limit }),
      this.prisma.product.count({ where }),
    ]);

    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async getById(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async getBySlug(slug: string) {
    const product = await this.prisma.product.findUnique({ where: { slug } });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }
}
