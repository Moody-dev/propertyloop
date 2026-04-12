import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  EscrowStatus,
  ListingType,
  RentalApplicationStatus,
} from '../../generated/prisma/client';
import { CreateRentalApplicationDto } from './dto/create-rental-application.dto';

@Injectable()
export class RentalApplicationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateRentalApplicationDto, buyerUserId?: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: dto.listingId },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.type !== ListingType.RENT) {
      throw new BadRequestException('This listing is not for rent');
    }

    const serviceFee = Math.round(dto.deposit * 0.05);
    const total = dto.deposit + dto.agencyFee + dto.legalFee + serviceFee;
    const escrowId = `RNT-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    const application = await this.prisma.rentalApplication.create({
      data: {
        listingId: listing.id,
        buyerUserId,
        applicantName: dto.applicantName,
        applicantPhone: dto.applicantPhone,
        applicantEmail: dto.applicantEmail,
        deposit: dto.deposit,
        agencyFee: dto.agencyFee,
        legalFee: dto.legalFee,
        serviceFee,
        total,
        leaseDuration: dto.leaseDuration,
        startDate: dto.startDate,
        paymentMethod: dto.paymentMethod,
        escrowId,
        escrowStatus: EscrowStatus.LOCKED,
        status: RentalApplicationStatus.PENDING,
      },
      include: {
        listing: {
          select: {
            id: true,
            title: true,
            coverImage: true,
            location: true,
            address: true,
            priceLabel: true,
          },
        },
      },
    });

    return application;
  }

  async listForBuyer(buyerUserId: string, page = 1, limit = 24) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.rentalApplication.findMany({
        where: { buyerUserId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          listing: {
            select: { id: true, title: true, coverImage: true, location: true },
          },
        },
      }),
      this.prisma.rentalApplication.count({ where: { buyerUserId } }),
    ]);
    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async getById(appId: string, userId: string) {
    const app = await this.prisma.rentalApplication.findUnique({
      where: { id: appId },
      include: { listing: true },
    });
    if (!app) throw new NotFoundException('Application not found');
    if (app.buyerUserId !== userId) {
      throw new ForbiddenException('You can only view your own applications');
    }
    return app;
  }

  /** Mark deposit as paid — moves status to DEPOSIT_PAID */
  async markDepositPaid(appId: string, userId: string) {
    const app = await this.prisma.rentalApplication.findUnique({
      where: { id: appId },
    });
    if (!app) throw new NotFoundException('Application not found');
    if (app.buyerUserId !== userId) {
      throw new ForbiddenException('Not your application');
    }
    if (app.status !== RentalApplicationStatus.PENDING) {
      throw new BadRequestException('Deposit already paid or application is not pending');
    }

    return this.prisma.rentalApplication.update({
      where: { id: appId },
      data: { status: RentalApplicationStatus.DEPOSIT_PAID },
    });
  }

  /** Mark agreement signed — moves status to AGREEMENT_SIGNED, then ACTIVE */
  async markSigned(appId: string, userId: string) {
    const app = await this.prisma.rentalApplication.findUnique({
      where: { id: appId },
    });
    if (!app) throw new NotFoundException('Application not found');
    if (app.buyerUserId !== userId) {
      throw new ForbiddenException('Not your application');
    }
    if (app.status !== RentalApplicationStatus.DEPOSIT_PAID) {
      throw new BadRequestException('Deposit must be paid before signing');
    }

    return this.prisma.rentalApplication.update({
      where: { id: appId },
      data: {
        status: RentalApplicationStatus.ACTIVE,
        escrowStatus: EscrowStatus.RELEASED,
        signedAt: new Date(),
      },
    });
  }

  async cancel(appId: string, userId: string) {
    const app = await this.prisma.rentalApplication.findUnique({
      where: { id: appId },
    });
    if (!app) throw new NotFoundException('Application not found');
    if (app.buyerUserId !== userId) {
      throw new ForbiddenException('Not your application');
    }
    if (
      app.status === RentalApplicationStatus.ACTIVE ||
      app.status === RentalApplicationStatus.COMPLETED ||
      app.status === RentalApplicationStatus.CANCELLED
    ) {
      throw new BadRequestException('This application cannot be cancelled');
    }

    return this.prisma.rentalApplication.update({
      where: { id: appId },
      data: {
        status: RentalApplicationStatus.CANCELLED,
        escrowStatus: EscrowStatus.REFUNDED,
      },
    });
  }
}
