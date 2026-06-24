import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification-types';
import {
  DisputeAuthorRole,
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
import { AddDisputeMessageDto } from './dto/add-dispute-message.dto';

// Vendors get 48 hours to respond once a dispute is raised.
const DISPUTE_RESPONSE_WINDOW_MS = 48 * 60 * 60 * 1000;
const SYSTEM_MEDIATION_NOTE = '⚖️ PropertyLoop is mediating this dispute';

function nairaLabel(n: number) {
  return `₦${Math.round(n).toLocaleString('en-NG')}`;
}

@Injectable()
export class VendorJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsService: PaymentsService,
    private readonly notifications: NotificationsService,
  ) {}

  // ─── Booking creation (buyer → vendor) ───────────────────────────────────

  async createBooking(dto: CreateBookingDto, buyerUserId?: string) {
    // A vendor can't book their own service — it would let them inflate their
    // own job stats and run money through their own escrow.
    if (buyerUserId && buyerUserId === dto.vendorId) {
      throw new BadRequestException('You cannot book your own service');
    }

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
        escrowStatus: EscrowStatus.NONE, // Payment not yet initiated
        paymentMethod: dto.paymentMethod,
        scheduledFor: dto.scheduledFor,
        status: JobStatus.PENDING,
        attachments: dto.attachments ?? [],
      },
      include: {
        vendor: { include: { vendorProfile: true } },
      },
    });

    void this.notifications.notify({
      userId: vendor.id,
      type: NotificationType.JOB_REQUEST,
      title: 'New service request',
      body: `${dto.clientName} requested ${job.title} · ${nairaLabel(job.vendorFee)}`,
      data: { jobId: job.id },
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
    const updated = await this.prisma.vendorJob.update({
      where: { id: jobId },
      data: {
        status: JobStatus.COMPLETED,
        completedAt: new Date(),
        completionNotes: dto.completionNotes,
        completionProofImages: dto.completionProofImages ?? [],
      },
    });

    if (job.buyerUserId) {
      void this.notifications.notify({
        userId: job.buyerUserId,
        type: NotificationType.JOB_COMPLETED,
        title: 'Service marked complete',
        body: `${job.title} is done. Review and confirm to release ${nairaLabel(job.vendorFee)} from escrow.`,
        data: { jobId },
      });
    }

    return updated;
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
      throw new BadRequestException('Escrow must be locked (payment confirmed) before confirming');
    }

    // Call payments service to release escrow and initiate transfer
    await this.paymentsService.releaseEscrow(jobId, buyerUserId);

    void this.notifications.notify({
      userId: job.vendorUserId,
      type: NotificationType.JOB_CONFIRMED,
      title: 'Payment released',
      body: `${job.clientName} confirmed ${job.title}. ${nairaLabel(job.vendorFee)} is on its way.`,
      data: { jobId },
    });

    // Fetch and return the updated job
    return this.prisma.vendorJob.findUnique({
      where: { id: jobId },
      include: { vendor: { include: { vendorProfile: true } } },
    });
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

    // Open the dispute and seed the thread: the customer's claim + a system
    // note that PropertyLoop is now mediating.
    const [updated] = await this.prisma.$transaction([
      this.prisma.vendorJob.update({
        where: { id: jobId },
        data: {
          escrowStatus: EscrowStatus.DISPUTED,
          disputeReason: dto.disputeReason,
          disputedAt: new Date(),
        },
      }),
      this.prisma.jobDisputeMessage.create({
        data: {
          jobId,
          senderUserId: buyerUserId,
          role: DisputeAuthorRole.CUSTOMER,
          body: dto.disputeReason,
        },
      }),
      this.prisma.jobDisputeMessage.create({
        data: {
          jobId,
          role: DisputeAuthorRole.SYSTEM,
          body: SYSTEM_MEDIATION_NOTE,
        },
      }),
    ]);

    void this.notifications.notify({
      userId: job.vendorUserId,
      type: NotificationType.JOB_DISPUTED,
      title: 'Customer raised a dispute',
      body: `${job.clientName} disputed ${job.title}. Respond with evidence within 48 hours.`,
      data: { jobId: job.id },
    });

    return updated;
  }

  // ─── Dispute thread ──────────────────────────────────────────────────────

  async getDispute(jobId: string, requestingUserId: string) {
    const job = await this.prisma.vendorJob.findUnique({
      where: { id: jobId },
      include: {
        vendor: true,
        disputeMessages: {
          orderBy: { createdAt: 'asc' },
          include: { sender: true },
        },
      },
    });
    if (!job) throw new NotFoundException('Job not found');
    if (
      job.vendorUserId !== requestingUserId &&
      job.buyerUserId !== requestingUserId
    ) {
      throw new ForbiddenException('You are not a party to this job');
    }
    return this.serializeDispute(job);
  }

  async addDisputeMessage(
    jobId: string,
    userId: string,
    dto: AddDisputeMessageDto,
  ) {
    const job = await this.prisma.vendorJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');

    let role: DisputeAuthorRole;
    if (job.vendorUserId === userId) role = DisputeAuthorRole.VENDOR;
    else if (job.buyerUserId === userId) role = DisputeAuthorRole.CUSTOMER;
    else throw new ForbiddenException('You are not a party to this job');

    if (job.escrowStatus !== EscrowStatus.DISPUTED) {
      throw new BadRequestException('This job is not currently under dispute');
    }

    await this.prisma.jobDisputeMessage.create({
      data: {
        jobId,
        senderUserId: userId,
        role,
        body: dto.body,
        attachments: dto.attachments ?? [],
      },
    });

    return this.getDispute(jobId, userId);
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
      attachments: job.attachments ?? [],
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

  private serializeDispute(job: any) {
    const deadline = job.disputedAt
      ? new Date(job.disputedAt.getTime() + DISPUTE_RESPONSE_WINDOW_MS)
      : null;
    return {
      jobId: job.id,
      jobRef: `SL-${job.id.slice(-8).toUpperCase()}`,
      status: job.escrowStatus,
      reason: job.disputeReason,
      disputedAt: job.disputedAt,
      responseDeadline: deadline,
      amountHeldNaira: job.escrowAmount,
      amountTotalNaira: job.amount,
      service: job.category,
      title: job.title,
      address: job.address,
      scheduledFor: job.scheduledFor,
      completedAt: job.completedAt,
      customer: {
        name: job.clientName,
        avatar: job.clientAvatar ?? null,
      },
      vendor: job.vendor
        ? { id: job.vendor.id, name: job.vendor.name, avatar: job.vendor.avatarUrl }
        : null,
      thread: (job.disputeMessages ?? []).map((m: any) =>
        this.serializeDisputeMessage(m, job),
      ),
    };
  }

  private serializeDisputeMessage(m: any, job: any) {
    let author: string;
    if (m.role === DisputeAuthorRole.CUSTOMER) {
      author = job.clientName ?? 'Customer';
    } else if (m.role === DisputeAuthorRole.VENDOR) {
      author = job.vendor?.name ?? 'Vendor';
    } else if (m.role === DisputeAuthorRole.ADMIN) {
      author = m.sender?.name ?? 'PropertyLoop';
    } else {
      author = 'System';
    }
    return {
      id: m.id,
      role: m.role,
      author,
      body: m.body,
      attachments: m.attachments ?? [],
      createdAt: m.createdAt,
    };
  }
}
