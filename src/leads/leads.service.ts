import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LeadStatus, Prisma } from '../../generated/prisma/client';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { ListLeadsDto } from './dto/list-leads.dto';
import { StaffAlertsService } from '../staff-alerts/staff-alerts.service';

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    // Optional so a unit test can build the service with Prisma alone.
    @Optional() private readonly alerts?: StaffAlertsService,
  ) {}

  async create(dto: CreateLeadDto, buyerUserId?: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: dto.listingId },
      select: { id: true, agentId: true, title: true },
    });
    if (!listing) throw new NotFoundException('Listing not found');

    const lead = await this.prisma.lead.create({
      data: {
        listingId: listing.id,
        agentId: listing.agentId,
        buyerUserId,
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        message: dto.message,
        source: dto.source ?? 'LISTING_PAGE',
      },
      include: {
        listing: {
          select: { id: true, title: true, coverImage: true, location: true },
        },
      },
    });
    this.alerts?.houseEnquiry(listing.id, dto.name);
    return lead;
  }

  async listForAgent(agentId: string, dto: ListLeadsDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 24;
    const skip = (page - 1) * limit;

    const where: Prisma.LeadWhereInput = { agentId };
    if (dto.status) where.status = dto.status;

    const [items, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
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
      this.prisma.lead.count({ where }),
    ]);

    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async getOne(agentId: string, leadId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        listing: true,
      },
    });
    if (!lead) throw new NotFoundException('Lead not found');
    if (lead.agentId !== agentId) {
      throw new ForbiddenException('You can only view your own leads');
    }
    return lead;
  }

  async update(agentId: string, leadId: string, dto: UpdateLeadDto) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new NotFoundException('Lead not found');
    if (lead.agentId !== agentId) {
      throw new ForbiddenException('You can only update your own leads');
    }

    const data: Prisma.LeadUpdateInput = {};
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.status !== undefined) {
      data.status = dto.status;
      if (
        dto.status === LeadStatus.CONTACTED &&
        lead.status === LeadStatus.NEW
      ) {
        data.contactedAt = new Date();
      }
    }

    return this.prisma.lead.update({
      where: { id: leadId },
      data,
      include: {
        listing: {
          select: { id: true, title: true, coverImage: true, location: true },
        },
      },
    });
  }

  async remove(agentId: string, leadId: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new NotFoundException('Lead not found');
    if (lead.agentId !== agentId) {
      throw new ForbiddenException('You can only delete your own leads');
    }
    await this.prisma.lead.delete({ where: { id: leadId } });
    return { success: true };
  }
}
