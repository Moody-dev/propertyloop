import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  EarningStatus,
  Prisma,
} from '../../generated/prisma/client';
import { ListEarningsDto } from './dto/list-earnings.dto';

@Injectable()
export class VendorEarningsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(vendorUserId: string, dto: ListEarningsDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 24;
    const skip = (page - 1) * limit;

    const where: Prisma.VendorEarningWhereInput = { vendorUserId };
    if (dto.status) where.status = dto.status;

    const [items, total] = await Promise.all([
      this.prisma.vendorEarning.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          job: {
            select: {
              id: true,
              title: true,
              clientName: true,
              category: true,
              scheduledFor: true,
              // Surfaced so the earnings screen can flag money held by a dispute
              // (escrow LOCKED→DISPUTED) instead of the generic "awaiting confirm".
              escrowStatus: true,
            },
          },
        },
      }),
      this.prisma.vendorEarning.count({ where }),
    ]);

    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async getSummary(vendorUserId: string) {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const startOfYear = new Date(startOfMonth);
    startOfYear.setMonth(0);

    // Money counts as "earned/gotten" once it's out of escrow and belongs to the
    // vendor: AVAILABLE (withdrawable), PROCESSING (withdrawing), or PAID (in bank).
    // PENDING is still in escrow (not theirs yet); refunded earnings are deleted.
    const EARNED = [
      EarningStatus.AVAILABLE,
      EarningStatus.PROCESSING,
      EarningStatus.PAID,
    ];

    const [
      earnedAgg,
      earnedMonthAgg,
      earnedYearAgg,
      paidAgg,
      pendingAgg,
      processingAgg,
      availableAgg,
      count,
    ] = await Promise.all([
      // Lifetime earned — "overall money made since usage".
      this.prisma.vendorEarning.aggregate({
        where: { vendorUserId, status: { in: EARNED } },
        _sum: { amount: true },
      }),
      // Earned this month — by when the earning was recorded, not when withdrawn.
      this.prisma.vendorEarning.aggregate({
        where: { vendorUserId, status: { in: EARNED }, createdAt: { gte: startOfMonth } },
        _sum: { amount: true },
      }),
      this.prisma.vendorEarning.aggregate({
        where: { vendorUserId, status: { in: EARNED }, createdAt: { gte: startOfYear } },
        _sum: { amount: true },
      }),
      this.prisma.vendorEarning.aggregate({
        where: { vendorUserId, status: EarningStatus.PAID },
        _sum: { amount: true },
      }),
      this.prisma.vendorEarning.aggregate({
        where: { vendorUserId, status: EarningStatus.PENDING },
        _sum: { amount: true },
      }),
      this.prisma.vendorEarning.aggregate({
        where: { vendorUserId, status: EarningStatus.PROCESSING },
        _sum: { amount: true },
      }),
      this.prisma.vendorEarning.aggregate({
        where: { vendorUserId, status: EarningStatus.AVAILABLE },
        _sum: { amount: true },
      }),
      this.prisma.vendorEarning.count({ where: { vendorUserId } }),
    ]);

    return {
      total: earnedAgg._sum.amount ?? 0,
      paid: paidAgg._sum.amount ?? 0,
      pending: pendingAgg._sum.amount ?? 0,
      processing: processingAgg._sum.amount ?? 0,
      available: availableAgg._sum.amount ?? 0,
      thisMonth: earnedMonthAgg._sum.amount ?? 0,
      thisYear: earnedYearAgg._sum.amount ?? 0,
      count,
    };
  }
}
