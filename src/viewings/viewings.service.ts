import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, ViewingStatus } from '../../generated/prisma/client';
import { CreateViewingDto } from './dto/create-viewing.dto';
import { UpdateViewingDto } from './dto/update-viewing.dto';
import { ListViewingsDto } from './dto/list-viewings.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification-types';
import { HouseEnquiryService } from '../stock-alerts/house-enquiry.service';

@Injectable()
export class ViewingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    // Optional so an existing unit test can build this with Prisma alone.
    @Optional() private readonly houseEnquiry?: HouseEnquiryService,
  ) {}

  async create(dto: CreateViewingDto, buyerUserId?: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: dto.listingId },
      select: { id: true, agentId: true },
    });
    if (!listing) throw new NotFoundException('Listing not found');

    // Signed-in buyers don't re-enter their details — fall back to the profile.
    let clientName = dto.clientName?.trim();
    let clientPhone = dto.clientPhone?.trim();
    let clientEmail = dto.clientEmail?.trim();
    if (buyerUserId) {
      const user = await this.prisma.user.findUnique({
        where: { id: buyerUserId },
        select: { name: true, phone: true, email: true },
      });
      clientName = clientName || user?.name || undefined;
      clientPhone = clientPhone || user?.phone || undefined;
      clientEmail = clientEmail || user?.email || undefined;
    }

    if (!clientName) {
      throw new BadRequestException('A name is required to book a viewing');
    }
    if (!clientPhone) {
      throw new BadRequestException(
        'A phone number is required so the agent can reach you',
      );
    }

    const viewing = await this.prisma.viewing.create({
      data: {
        listingId: listing.id,
        agentId: listing.agentId,
        buyerUserId,
        clientName,
        clientPhone,
        clientEmail,
        scheduledFor: dto.scheduledFor,
        notes: dto.notes,
      },
      include: {
        listing: {
          select: { id: true, title: true, coverImage: true, location: true },
        },
      },
    });

    // On PropertyLoop's own stock the "agent" is the staff member who filed
    // it, so the request also becomes a lead the team can see and work.
    this.houseEnquiry?.record({
      listingId: listing.id,
      kind: 'VIEWING',
      name: clientName,
      phone: clientPhone,
      email: clientEmail,
      message: dto.notes,
      buyerUserId,
    });

    // Ping the listing agent that a buyer wants a viewing.
    void this.notifications.notify({
      userId: listing.agentId,
      type: NotificationType.VIEWING_REQUESTED,
      title: 'New viewing request',
      body: `${clientName} requested to view ${viewing.listing?.title ?? 'your listing'}`,
      data: { viewingId: viewing.id, listingId: listing.id },
    });

    return viewing;
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
            select: {
              id: true,
              title: true,
              coverImage: true,
              location: true,
              slug: true,
            },
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

    const updated = await this.prisma.viewing.update({
      where: { id: viewingId },
      data: {
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.scheduledFor !== undefined && {
          scheduledFor: dto.scheduledFor,
        }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
      include: {
        listing: {
          select: { id: true, title: true, coverImage: true, location: true },
        },
      },
    });

    // Tell the buyer when the agent confirms, reschedules, or cancels.
    if (viewing.buyerUserId) {
      const title = updated.listing?.title ?? 'the property';
      const rescheduled =
        dto.scheduledFor !== undefined &&
        dto.status !== ViewingStatus.CANCELLED;
      if (dto.status === ViewingStatus.CONFIRMED || rescheduled) {
        void this.notifications.notify({
          userId: viewing.buyerUserId,
          type: NotificationType.VIEWING_CONFIRMED,
          title: rescheduled ? 'Viewing rescheduled' : 'Viewing confirmed',
          body: rescheduled
            ? `The agent proposed a new time for ${title}`
            : `Your viewing of ${title} is confirmed`,
          data: { viewingId: updated.id, listingId: updated.listingId },
        });
      } else if (dto.status === ViewingStatus.CANCELLED) {
        void this.notifications.notify({
          userId: viewing.buyerUserId,
          type: NotificationType.VIEWING_CANCELLED,
          title: 'Viewing cancelled',
          body: `Your viewing of ${title} was cancelled by the agent`,
          data: { viewingId: updated.id, listingId: updated.listingId },
        });
      }
    }

    return updated;
  }

  async cancel(agentId: string, viewingId: string) {
    return this.update(agentId, viewingId, { status: ViewingStatus.CANCELLED });
  }

  async listForBuyer(buyerUserId: string, dto: ListViewingsDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 24;
    const skip = (page - 1) * limit;

    const where: Prisma.ViewingWhereInput = { buyerUserId };
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
            select: {
              id: true,
              title: true,
              coverImage: true,
              location: true,
              slug: true,
            },
          },
          agent: {
            select: { id: true, name: true, phone: true, avatarUrl: true },
          },
        },
      }),
      this.prisma.viewing.count({ where }),
    ]);

    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  // ─── Admin scope ────────────────────────────────────────────────────────

  async listAll(dto: ListViewingsDto & { search?: string }) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 24;
    const skip = (page - 1) * limit;

    const where: Prisma.ViewingWhereInput = {};
    if (dto.status) where.status = dto.status;
    if (dto.upcoming) where.scheduledFor = { gte: new Date() };
    if (dto.search) {
      where.OR = [
        { clientName: { contains: dto.search, mode: 'insensitive' } },
        { clientPhone: { contains: dto.search, mode: 'insensitive' } },
        { clientEmail: { contains: dto.search, mode: 'insensitive' } },
        { listing: { title: { contains: dto.search, mode: 'insensitive' } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.viewing.findMany({
        where,
        orderBy: { scheduledFor: dto.upcoming ? 'asc' : 'desc' },
        skip,
        take: limit,
        include: {
          listing: {
            select: {
              id: true,
              title: true,
              coverImage: true,
              location: true,
              slug: true,
            },
          },
          agent: {
            select: {
              id: true,
              name: true,
              email: true,
              avatarUrl: true,
              phone: true,
            },
          },
        },
      }),
      this.prisma.viewing.count({ where }),
    ]);

    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async setStatus(viewingId: string, status: ViewingStatus) {
    const viewing = await this.prisma.viewing.findUnique({
      where: { id: viewingId },
    });
    if (!viewing) throw new NotFoundException('Viewing not found');
    return this.prisma.viewing.update({
      where: { id: viewingId },
      data: { status },
      include: {
        listing: {
          select: { id: true, title: true, coverImage: true, location: true },
        },
        agent: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
            phone: true,
          },
        },
      },
    });
  }

  async removeAsAdmin(viewingId: string) {
    const viewing = await this.prisma.viewing.findUnique({
      where: { id: viewingId },
    });
    if (!viewing) throw new NotFoundException('Viewing not found');
    await this.prisma.viewing.delete({ where: { id: viewingId } });
    return { success: true };
  }

  async cancelMine(buyerUserId: string, viewingId: string) {
    const viewing = await this.prisma.viewing.findUnique({
      where: { id: viewingId },
    });
    if (!viewing) throw new NotFoundException('Viewing not found');
    if (viewing.buyerUserId !== buyerUserId) {
      throw new ForbiddenException('You can only cancel your own viewings');
    }
    if (
      viewing.status !== ViewingStatus.PENDING &&
      viewing.status !== ViewingStatus.CONFIRMED
    ) {
      throw new ForbiddenException(
        'Only pending or confirmed viewings can be cancelled',
      );
    }
    const updated = await this.prisma.viewing.update({
      where: { id: viewingId },
      data: { status: ViewingStatus.CANCELLED },
      include: {
        listing: {
          select: { id: true, title: true, coverImage: true, location: true },
        },
      },
    });

    // Let the agent know the buyer pulled out.
    void this.notifications.notify({
      userId: viewing.agentId,
      type: NotificationType.VIEWING_CANCELLED,
      title: 'Viewing cancelled',
      body: `${viewing.clientName} cancelled their viewing of ${updated.listing?.title ?? 'your listing'}`,
      data: { viewingId: updated.id, listingId: updated.listingId },
    });

    return updated;
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
