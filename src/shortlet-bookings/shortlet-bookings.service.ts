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
  ShortletBookingStatus,
} from '../../generated/prisma/client';
import { CreateShortletBookingDto } from './dto/create-shortlet-booking.dto';

@Injectable()
export class ShortletBookingsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateShortletBookingDto, buyerUserId?: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: dto.listingId },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.type !== ListingType.SHORTLET) {
      throw new BadRequestException('This listing is not a shortlet');
    }

    const checkIn = new Date(dto.checkIn);
    const checkOut = new Date(dto.checkOut);
    if (checkOut <= checkIn) {
      throw new BadRequestException('Check-out must be after check-in');
    }

    const nights = Math.ceil(
      (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24),
    );
    // listing.priceNaira is BigInt; coerce to Number before multiplying
    // by `nights` (a plain JS Number). Naira values fit safely.
    const subtotal = Number(listing.priceNaira) * nights;
    const serviceFee = Math.round(subtotal * 0.1);
    const total = subtotal + serviceFee;
    const escrowId = `SHL-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    const booking = await this.prisma.shortletBooking.create({
      data: {
        listingId: listing.id,
        buyerUserId,
        guestName: dto.guestName,
        guestPhone: dto.guestPhone,
        guestEmail: dto.guestEmail,
        guests: dto.guests,
        checkIn,
        checkOut,
        nights,
        subtotal,
        serviceFee,
        total,
        paymentMethod: dto.paymentMethod,
        escrowId,
        escrowStatus: EscrowStatus.LOCKED,
        status: ShortletBookingStatus.CONFIRMED,
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

    return booking;
  }

  async listForBuyer(buyerUserId: string, page = 1, limit = 24) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.shortletBooking.findMany({
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
      this.prisma.shortletBooking.count({ where: { buyerUserId } }),
    ]);
    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async getById(bookingId: string, userId: string) {
    const booking = await this.prisma.shortletBooking.findUnique({
      where: { id: bookingId },
      include: { listing: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.buyerUserId !== userId) {
      throw new ForbiddenException('You can only view your own bookings');
    }
    return booking;
  }

  async cancel(bookingId: string, userId: string) {
    const booking = await this.prisma.shortletBooking.findUnique({
      where: { id: bookingId },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.buyerUserId !== userId) {
      throw new ForbiddenException('You can only cancel your own bookings');
    }
    if (
      booking.status === ShortletBookingStatus.COMPLETED ||
      booking.status === ShortletBookingStatus.CANCELLED
    ) {
      throw new BadRequestException('This booking cannot be cancelled');
    }

    return this.prisma.shortletBooking.update({
      where: { id: bookingId },
      data: {
        status: ShortletBookingStatus.CANCELLED,
        escrowStatus: EscrowStatus.REFUNDED,
      },
    });
  }
}
