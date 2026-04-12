import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BookmarkType } from '../../generated/prisma/client';

@Injectable()
export class BookmarksService {
  constructor(private readonly prisma: PrismaService) {}

  async listAll(userId: string) {
    return this.prisma.bookmark.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listByType(userId: string, type: BookmarkType) {
    const bookmarks = await this.prisma.bookmark.findMany({
      where: { userId, type },
      orderBy: { createdAt: 'desc' },
      include: {
        listing: type === 'PROPERTY' ? true : false,
        product: type === 'PRODUCT' ? true : false,
      },
    });
    return bookmarks;
  }

  async toggle(userId: string, body: { entityId: string; type: BookmarkType }) {
    const { entityId, type } = body;

    const where = this.buildUniqueWhere(userId, entityId, type);
    const existing = await this.prisma.bookmark.findFirst({ where: where as any });

    if (existing) {
      await this.prisma.bookmark.delete({ where: { id: existing.id } });
      return { bookmarked: false, id: existing.id };
    }

    const data: any = { userId, type };
    if (type === 'PROPERTY') data.listingId = entityId;
    else if (type === 'PRODUCT') data.productId = entityId;
    else if (type === 'SERVICE') data.vendorUserId = entityId;

    const created = await this.prisma.bookmark.create({ data });
    return { bookmarked: true, id: created.id };
  }

  async remove(userId: string, bookmarkId: string) {
    const bookmark = await this.prisma.bookmark.findUnique({
      where: { id: bookmarkId },
    });
    if (!bookmark || bookmark.userId !== userId) {
      throw new NotFoundException('Bookmark not found');
    }
    await this.prisma.bookmark.delete({ where: { id: bookmarkId } });
    return { success: true };
  }

  async isBookmarked(userId: string, entityId: string, type: BookmarkType) {
    const where = this.buildUniqueWhere(userId, entityId, type);
    const existing = await this.prisma.bookmark.findFirst({ where: where as any });
    return { bookmarked: !!existing };
  }

  private buildUniqueWhere(userId: string, entityId: string, type: BookmarkType) {
    const base: any = { userId, type };
    if (type === 'PROPERTY') base.listingId = entityId;
    else if (type === 'PRODUCT') base.productId = entityId;
    else if (type === 'SERVICE') base.vendorUserId = entityId;
    return base;
  }
}
