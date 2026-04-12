import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  EarningStatus,
  EscrowStatus,
  JobStatus,
  Prisma,
  Role,
} from '../../generated/prisma/client';
import { CreateBookingDto } from './dto/create-booking.dto';
import { ListJobsDto } from './dto/list-jobs.dto';
import { CompleteJobDto } from './dto/complete-job.dto';
import { DisputeJobDto } from './dto/dispute-job.dto';

@Injectable()
export class VendorJobsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Booking creation (buyer → vendor) ───────────────────────────────────

  async createBooking(dto: CreateBookingDto, buyerUserId?: string) {
    const vendor = await this.prisma.user.findFirst({
      where: {
        id: dto.vendorId,
        role: Role.VENDOR,
        isActive: true,
        deletedAt: null,
      },
      include: { vendorProfile: true },
    });
    if (!vendor || !vendor.vendorProfile) {
      throw new NotFoundException('Vendor not found');
    }
    if (!vendor.vendorProfile.availableForHire) {
      throw new BadRequestException('This vendor is not accepting new bookings');
    }

    const vendorFee = Math.max(0, Math.floor(dto.vendorFee));
    const platformFee = Math.round(vendorFee * 0.1);
    const escrowAmount = vendorFee + platformFee;
    const escrowId = `ESC-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    const job = await this.prisma.vendorJob.create({
      data: {
        vendorUserId: vendor.id,
        buyerUserId,
        title: dto.title,
        description: dto.description,
        address: dto.address,
        category: dto.category ?? vendor.vendorProfile.serviceCategory,
        clientName: dto.clientName,
        clientPhone: dto.clientPhone,
        clientEmail: dto.clientEmail,
        amount: vendorFee, // keep in sync with vendorFee for legacy reads
        vendorFee,
        platformFee,
        escrowAmount,
        escrowId,
        escrowStatus: EscrowStatus.LOCKED,
        paymentMethod: dto.paymentMethod,
        scheduledFor: dto.scheduledFor,
        status: JobStatus.PENDING,
      },
      include: {
        vendor: { include: { vendorProfile: true } },
      },
    });

    return this.serialize(job);
  }

  // ─── Listings ────────────────────────────────────────────────────────────

  async listForVendor(vendorUserId: string, dto: ListJobsDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 24;
    const skip = (page - 1) * limit;

    const where: Prisma.VendorJobWhereInput = { vendorUserId };
    if (dto.status) where.status = dto.status;

    const [items, total] = await Promise.all([
      this.prisma.vendorJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.vendorJob.count({ where }),
    ]);

    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async listForBuyer(buyerUserId: string, dto: ListJobsDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 24;
    const skip = (page - 1) * limit;

    const where: Prisma.VendorJobWhereInput = { buyerUserId };
    if (dto.status) where.status = dto.status;

    const [items, total] = await Promise.all([
      this.prisma.vendorJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          vendor: { include: { vendorProfile: true } },
        },
      }),
      this.prisma.vendorJob.count({ where }),
    ]);

    return {
      items: items.map((j) => this.serialize(j)),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  async getOne(jobId: string, requestingUserId: string) {
    const job = await this.prisma.vendorJob.findUnique({
      where: { id: jobId },
      include: {
        vendor: { include: { vendorProfile: true } },
      },
    });
    if (!job) throw new NotFoundException('Job not found');
    if (job.vendorUserId !== requestingUserId && job.buyerUserId !== requestingUserId) {
      throw new ForbiddenException('You are not a party to this job');
    }
    return this.serialize(job);
  }

  // ─── State transitions (vendor side) ─────────────────────────────────────

  async accept(vendorUserId: string, jobId: string) {
    const job = await this.assertVendorOwns(vendorUserId, jobId);
    if (job.status !== JobStatus.PENDING) {
      throw new BadRequestException('Only pending jobs can be accepted');
    }
    return this.prisma.vendorJob.update({
      where: { id: jobId },
      data: { status: JobStatus.ACCEPTED },
    });
  }

  async decline(vendorUserId: string, jobId: string) {
    const job = await this.assertVendorOwns(vendorUserId, jobId);
    if (job.status !== JobStatus.PENDING) {
      throw new BadRequestException('Only pending jobs can be declined');
    }
    // Deleting the job is the cleanest way to model a decline without adding
    // a new enum value. Escrow hasn't been released so no money accounting needed.
    await this.prisma.vendorJob.delete({ where: { id: jobId } });
    return { success: true };
  }

  async start(vendorUserId: string, jobId: string) {
    const job = await this.assertVendorOwns(vendorUserId, jobId);
    if (job.status !== JobStatus.ACCEPTED) {
      throw new BadRequestException('Only accepted jobs can be started');
    }
    return this.prisma.vendorJob.update({
      where: { id: jobId },
      data: { status: JobStatus.IN_PROGRESS },
    });
  }

  async complete(vendorUserId: string, jobId: string, dto: CompleteJobDto) {
    const job = await this.assertVendorOwns(vendorUserId, jobId);
    if (job.status !== JobStatus.IN_PROGRESS && job.status !== JobStatus.ACCEPTED) {
      throw new BadRequestException('Only active jobs can be marked complete');
    }
    return this.prisma.vendorJob.update({
      where: { id: jobId },
      data: {
        status: JobStatus.COMPLETED,
        completedAt: new Date(),
        completionNotes: dto.completionNotes,
        completionProofImages: dto.completionProofImages ?? [],
      },
    });
  }

  // ─── State transitions (buyer side) ──────────────────────────────────────

  async confirm(buyerUserId: string, jobId: string) {
    const job = await this.prisma.vendorJob.findUnique({
      where: { id: jobId },
    });
    if (!job) throw new NotFoundException('Job not found');
    if (job.buyerUserId !== buyerUserId) {
      throw new ForbiddenException('Only the buyer can confirm this job');
    }
    if (job.status !== JobStatus.COMPLETED) {
      throw new BadRequestException('Only completed jobs can be confirmed');
    }
    if (job.escrowStatus !== EscrowStatus.LOCKED) {
      throw new BadRequestException('Escrow is not currently locked for this job');
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.vendorJob.update({
        where: { id: jobId },
        data: {
          status: JobStatus.PAID,
          escrowStatus: EscrowStatus.RELEASED,
          confirmedAt: new Date(),
        },
      }),
      this.prisma.vendorEarning.create({
        data: {
          vendorUserId: job.vendorUserId,
          jobId: job.id,
          jobTitle: job.title,
          clientName: job.clientName,
          amount: job.vendorFee,
          status: EarningStatus.PAID,
          paidAt: new Date(),
        },
      }),
      this.prisma.vendorProfile.update({
        where: { userId: job.vendorUserId },
        data: { jobsCount: { increment: 1 } },
      }),
    ]);

    return updated;
  }

  async dispute(buyerUserId: string, jobId: string, dto: DisputeJobDto) {
    const job = await this.prisma.vendorJob.findUnique({
      where: { id: jobId },
    });
    if (!job) throw new NotFoundException('Job not found');
    if (job.buyerUserId !== buyerUserId) {
      throw new ForbiddenException('Only the buyer can dispute this job');
    }
    if (job.status !== JobStatus.COMPLETED) {
      throw new BadRequestException('Only completed jobs can be disputed');
    }
    if (job.escrowStatus !== EscrowStatus.LOCKED) {
      throw new BadRequestException('Escrow is not currently locked for this job');
    }

    return this.prisma.vendorJob.update({
      where: { id: jobId },
      data: {
        escrowStatus: EscrowStatus.DISPUTED,
        disputeReason: dto.disputeReason,
        disputedAt: new Date(),
      },
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async assertVendorOwns(vendorUserId: string, jobId: string) {
    const job = await this.prisma.vendorJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');
    if (job.vendorUserId !== vendorUserId) {
      throw new ForbiddenException('You can only manage your own jobs');
    }
    return job;
  }

  private serialize(job: any) {
    const vendor = job.vendor;
    return {
      id: job.id,
      title: job.title,
      description: job.description,
      address: job.address,
      category: job.category,
      status: job.status,
      clientName: job.clientName,
      clientPhone: job.clientPhone,
      clientEmail: job.clientEmail,
      scheduledFor: job.scheduledFor,
      amount: job.amount,
      vendorFee: job.vendorFee,
      platformFee: job.platformFee,
      escrowAmount: job.escrowAmount,
      escrowId: job.escrowId,
      escrowStatus: job.escrowStatus,
      paymentMethod: job.paymentMethod,
      completionNotes: job.completionNotes,
      completionProofImages: job.completionProofImages,
      completedAt: job.completedAt,
      confirmedAt: job.confirmedAt,
      disputeReason: job.disputeReason,
      disputedAt: job.disputedAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      vendor: vendor
        ? {
            id: vendor.id,
            name: vendor.name,
            avatarUrl: vendor.avatarUrl,
            phone: vendor.phone,
            category: vendor.vendorProfile?.serviceCategory ?? null,
            rating: vendor.vendorProfile?.rating ?? 0,
            jobsCount: vendor.vendorProfile?.jobsCount ?? 0,
            verified: vendor.vendorProfile?.verified ?? false,
          }
        : null,
    };
  }
}
