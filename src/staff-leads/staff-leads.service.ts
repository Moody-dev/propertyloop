import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LeadStatus, Prisma } from '../../generated/prisma/client';
import { CreateStaffLeadDto } from './dto/create-staff-lead.dto';
import { UpdateStaffLeadDto } from './dto/update-staff-lead.dto';

/**
 * Leads as the staff portal sees them.
 *
 * Deliberately separate from LeadsService, which is the agent-facing view:
 * that one is scoped to `agentId` and answers "my enquiries" for one agent.
 * This one answers "the company's enquiries" and is scoped by permission
 * instead. Same table, genuinely different question — folding them together
 * would mean one of the two callers getting rows it should not see.
 */

const LEAD_SELECT = {
  id: true,
  name: true,
  phone: true,
  source: true,
  status: true,
  qualified: true,
  budgetNaira: true,
  notes: true,
  listingId: true,
  ownerStaffId: true,
  contactedAt: true,
  firstRespondedAt: true,
  createdAt: true,
} satisfies Prisma.LeadSelect;

type LeadRow = Prisma.LeadGetPayload<{ select: typeof LEAD_SELECT }>;

@Injectable()
export class StaffLeadsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * budgetNaira is BigInt in the database. main.ts teaches JSON.stringify to
   * serialise BigInt, but converting here keeps the shape explicit for
   * anything reading the service directly.
   *
   * firstResponseMins is derived rather than stored: storing a duration means
   * recomputing it whenever either end moves, and the two timestamps are the
   * facts.
   */
  private shape(lead: LeadRow) {
    const { budgetNaira, firstRespondedAt, contactedAt, ...rest } = lead;
    const responded = firstRespondedAt ?? contactedAt;
    return {
      ...rest,
      propertyId: lead.listingId,
      ownerId: lead.ownerStaffId,
      budgetNaira: budgetNaira === null ? null : Number(budgetNaira),
      lastContactAt: contactedAt,
      firstResponseMins: responded
        ? Math.max(
            0,
            Math.round(
              (responded.getTime() - lead.createdAt.getTime()) / 60_000,
            ),
          )
        : null,
    };
  }

  async list(params: {
    status?: LeadStatus;
    ownerId?: string;
    qualified?: boolean;
  }) {
    const leads = await this.prisma.lead.findMany({
      where: {
        ...(params.status && { status: params.status }),
        ...(params.ownerId && { ownerStaffId: params.ownerId }),
        ...(params.qualified !== undefined && { qualified: params.qualified }),
      },
      select: LEAD_SELECT,
      orderBy: { createdAt: 'desc' },
    });
    return leads.map((l) => this.shape(l));
  }

  async findOne(id: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id },
      select: LEAD_SELECT,
    });
    if (!lead) throw new NotFoundException('Lead not found');
    return this.shape(lead);
  }

  /**
   * A lead logged by hand — someone who rang, or was referred.
   *
   * Lead.listingId is required by the table, because every lead the website
   * creates comes from a listing page. A phone call need not be about a
   * property at all, but making the column nullable would change the meaning
   * of every existing row, so instead the property is required here and the
   * form asks for it. agentId follows from the listing rather than from
   * whoever typed the lead in: it is the listing's owner, and leads are
   * counted against them.
   */
  async create(dto: CreateStaffLeadDto, staffId: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: dto.propertyId },
      select: { id: true, agentId: true },
    });
    if (!listing) throw new NotFoundException('Property not found');

    const lead = await this.prisma.lead.create({
      data: {
        listingId: listing.id,
        agentId: listing.agentId,
        name: dto.name,
        phone: dto.phone,
        source: dto.source,
        notes: dto.notes ?? '',
        ownerStaffId: dto.ownerId ?? staffId,
        qualified: dto.qualified ?? false,
        ...(dto.budgetNaira != null && {
          budgetNaira: BigInt(Math.round(dto.budgetNaira)),
        }),
      },
      select: LEAD_SELECT,
    });
    return this.shape(lead);
  }

  async update(id: string, dto: UpdateStaffLeadDto) {
    const existing = await this.prisma.lead.findUnique({
      where: { id },
      select: { id: true, status: true, contactedAt: true },
    });
    if (!existing) throw new NotFoundException('Lead not found');

    // Moving off NEW is the first response, and that is what the 30-minute
    // SLA is measured to. Stamped once — a later status change must not
    // rewrite history into a better number.
    const firstResponse =
      existing.contactedAt === null &&
      dto.status !== undefined &&
      dto.status !== LeadStatus.NEW;

    const lead = await this.prisma.lead.update({
      where: { id },
      data: {
        name: dto.name,
        phone: dto.phone,
        source: dto.source,
        status: dto.status,
        notes: dto.notes,
        qualified: dto.qualified,
        ownerStaffId: dto.ownerId,
        ...(dto.propertyId !== undefined && { listingId: dto.propertyId }),
        ...(dto.budgetNaira !== undefined && {
          budgetNaira:
            dto.budgetNaira === null
              ? null
              : BigInt(Math.round(dto.budgetNaira)),
        }),
        ...(firstResponse && {
          contactedAt: new Date(),
          firstRespondedAt: new Date(),
        }),
      },
      select: LEAD_SELECT,
    });
    return this.shape(lead);
  }

  async remove(id: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!lead) throw new NotFoundException('Lead not found');
    await this.prisma.lead.delete({ where: { id } });
    return { deleted: true };
  }
}
