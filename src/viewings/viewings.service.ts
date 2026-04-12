import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, ViewingStatus } from '../../generated/prisma/client';
import { CreateViewingDto } from './dto/create-viewing.dto';
import { UpdateViewingDto } from './dto/update-viewing.dto';
import { ListViewingsDto } from './dto/list-viewings.dto';

@Injectable()
export class ViewingsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateViewingDto, buyerUserId?: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: dto.listingId },
      select: { id: true, agentId: true },
    });
    if (!listing) throw new NotFoundException('Listing not found');

    return this.prisma.viewing.create({
      data: {
        listingId: listing.id,
        agentId: listing.agentId,
        buyerUserId,
        clientName: dto.clientName,
        clientPhone: dto.clientPhone,
        clientEmail: dto.clientEmail,
        scheduledFor: dto.scheduledFor,
        notes: dto.notes,
      },
      include: {
        listing: { select: { id: true, title: true, coverImage: true, location: true } },
      },
    });
  }

  async listForAgent(agentId: string, dto: ListViewingsDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 24;
    const skip = (page - 1) * limit;

    const where: Prisma.ViewingWhereInput = { agentId };
    if (dto.status) where.status = dto.status;
    if (dto.upcoming) where.scheduledFor = { gte: new Date() };

    const [items, total] = await Promise.all([
      this.prisma.viewing.findMany({
        where,
        orderBy: { scheduledFor: dto.upcoming ? 'asc' : 'desc' },
        skip,
        take: limit,
        include: {
          listing: {
            select: { id: true, title: true, coverImage: true, location: true, slug: true },
          },
        },
      }),
      this.prisma.viewing.count({ where }),
    ]);

    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async update(agentId: string, viewingId: string, dto: UpdateViewingDto) {
    const viewing = await this.prisma.viewing.findUnique({
      where: { id: viewingId },
    });
    if (!viewing) throw new NotFoundException('Viewing not found');
    if (viewing.agentId !== agentId) {
      throw new ForbiddenException('You can only update your own viewings');
    }

    return this.prisma.viewing.update({
      where: { id: viewingId },
      data: {
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.scheduledFor !== undefined && { scheduledFor: dto.scheduledFor }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
      include: {
        listing: { select: { id: true, title: true, coverImage: true, location: true } },
      },
    });
  }

  async cancel(agentId: string, viewingId: string) {
    return this.update(agentId, viewingId, { status: ViewingStatus.CANCELLED });
  }

  async remove(agentId: string, viewingId: string) {
    const viewing = await this.prisma.viewing.findUnique({
      where: { id: viewingId },
    });
    if (!viewing) throw new NotFoundException('Viewing not found');
    if (viewing.agentId !== agentId) {
      throw new ForbiddenException('You can only delete your own viewings');
    }
    await this.prisma.viewing.delete({ where: { id: viewingId } });
    return { success: true };
  }
}
