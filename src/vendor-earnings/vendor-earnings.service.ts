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

    const [
      paidAgg,
      pendingAgg,
      processingAgg,
      availableAgg,
      thisMonthAgg,
      thisYearAgg,
      count,
    ] = await Promise.all([
        this.prisma.vendorEarning.aggregate({
          where: { vendorUserId, status: EarningStatus.PAID },
          _sum: { amount: true },
          _count: true,
        }),
        this.prisma.vendorEarning.aggregate({
          where: { vendorUserId, status: EarningStatus.PENDING },
          _sum: { amount: true },
          _count: true,
        }),
        this.prisma.vendorEarning.aggregate({
          where: { vendorUserId, status: EarningStatus.PROCESSING },
          _sum: { amount: true },
          _count: true,
        }),
        this.prisma.vendorEarning.aggregate({
          where: { vendorUserId, status: EarningStatus.AVAILABLE },
          _sum: { amount: true },
          _count: true,
        }),
        this.prisma.vendorEarning.aggregate({
          where: {
            vendorUserId,
            status: EarningStatus.PAID,
            paidAt: { gte: startOfMonth },
          },
          _sum: { amount: true },
        }),
        this.prisma.vendorEarning.aggregate({
          where: {
            vendorUserId,
            status: EarningStatus.PAID,
            paidAt: { gte: startOfYear },
          },
          _sum: { amount: true },
        }),
        this.prisma.vendorEarning.count({ where: { vendorUserId } }),
      ]);

    const paid = paidAgg._sum.amount ?? 0;
    const pending = pendingAgg._sum.amount ?? 0;
    const processing = processingAgg._sum.amount ?? 0;
    const available = availableAgg._sum.amount ?? 0;

    return {
      total: paid + pending + processing + available,
      paid,
      pending,
      processing,
      available,
      thisMonth: thisMonthAgg._sum.amount ?? 0,
      thisYear: thisYearAgg._sum.amount ?? 0,
      count,
    };
  }
}
