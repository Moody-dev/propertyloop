import { Injectable, NotFoundException } from '@nestjs/common';
import { cleanDescription } from '../common/utils/sanitize';
import { PrismaService } from '../prisma/prisma.service';
import { MediaUrlService } from '../media/media-url.service';

export interface CreateFeaturedPropertyDto {
  title: string;
  location: string;
  priceNaira: number;
  priceLabel?: string;
  type: string;
  propertyType: string;
  beds?: number;
  baths?: number;
  sqft?: string;
  description?: string;
  imageUrls: string[];
  videoUrl?: string;
  videoUrls?: string[];
  displayOrder?: number;
  active?: boolean;
}

export type UpdateFeaturedPropertyDto = Partial<CreateFeaturedPropertyDto>;

@Injectable()
export class FeaturedPropertiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaUrl: MediaUrlService,
  ) {}

  /** Public: only active properties, ordered newest first */
  async listActive() {
    const items = await this.prisma.featuredProperty.findMany({
      where: { active: true },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
    });
    return items.map((p) => this.serialize(p));
  }

  /** Admin: all properties regardless of active flag */
  async listAll() {
    const items = await this.prisma.featuredProperty.findMany({
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
    });
    return items.map((p) => this.serialize(p));
  }

  async create(dto: CreateFeaturedPropertyDto) {
    const priceLabel =
      dto.priceLabel?.trim() ||
      `₦${Number(dto.priceNaira).toLocaleString('en-NG')}`;
    const item = await this.prisma.featuredProperty.create({
      data: {
        title: dto.title,
        location: dto.location,
        priceNaira: dto.priceNaira,
        priceLabel,
        type: dto.type,
        propertyType: dto.propertyType,
        beds: dto.beds ?? 0,
        baths: dto.baths ?? 0,
        sqft: dto.sqft,
        description: cleanDescription(dto.description),
        imageUrls: dto.imageUrls,
        videoUrl: dto.videoUrl,
        videoUrls: dto.videoUrls ?? [],
        displayOrder: dto.displayOrder ?? 0,
        active: dto.active ?? true,
      },
    });
    return this.serialize(item);
  }

  async update(id: string, dto: UpdateFeaturedPropertyDto) {
    const existing = await this.prisma.featuredProperty.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Featured property not found');

    const data: any = { ...dto };
    if (dto.description !== undefined) {
      data.description = cleanDescription(dto.description);
    }
    if (dto.priceNaira !== undefined && !dto.priceLabel?.trim()) {
      data.priceLabel = `₦${Number(dto.priceNaira).toLocaleString('en-NG')}`;
    }

    const item = await this.prisma.featuredProperty.update({
      where: { id },
      data,
    });
    return this.serialize(item);
  }

  async remove(id: string) {
    const existing = await this.prisma.featuredProperty.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Featured property not found');
    await this.prisma.featuredProperty.delete({ where: { id } });
    return { success: true };
  }

  private serialize(p: any) {
    return {
      ...p,
      priceNaira: Number(p.priceNaira),
      imageUrls: this.mediaUrl.rewriteMany(p.imageUrls),
    };
  }
}
