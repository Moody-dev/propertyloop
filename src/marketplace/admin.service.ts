import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Marketplace oversight for staff holding MANAGE_MARKETPLACE: every store,
 * every order, the money the platform is making, the payouts still owed, and
 * the controls to verify a store, set its commission, or settle an owed line.
 * Refunds and disputes live in MarketplaceDisputesService.
 */
@Injectable()
export class MarketplaceAdminService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Stores ────────────────────────────────────────────────────────────

  async listStores() {
    const stores = await this.prisma.marketplaceStore.findMany({
      orderBy: [{ createdAt: 'desc' }],
      include: {
        _count: { select: { products: true } },
        owner: { select: { id: true, name: true, email: true } },
      },
    });
    return stores.map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      category: s.category,
      logo: s.logo,
      owner: s.owner
        ? { id: s.owner.id, name: s.owner.name, email: s.owner.email }
        : null,
      commissionPct: s.commissionPct,
      commissionPctOverride: s.commissionPctOverride ?? null,
      verified: s.verified,
      active: s.active,
      rating: s.rating,
      ordersFulfilled: s.ordersFulfilled,
      products: s._count.products,
      createdAt: s.createdAt,
    }));
  }

  /** Verify / suspend a store, or set its negotiated commission override. */
  async updateStore(
    storeId: string,
    dto: {
      verified?: boolean;
      active?: boolean;
      commissionPctOverride?: number | null;
    },
  ) {
    const store = await this.prisma.marketplaceStore.findUnique({
      where: { id: storeId },
    });
    if (!store) throw new NotFoundException('Store not found');

    const updated = await this.prisma.marketplaceStore.update({
      where: { id: storeId },
      data: {
        verified: dto.verified ?? undefined,
        active: dto.active ?? undefined,
        // null clears the override (back to category rates); a number sets it.
        commissionPctOverride:
          dto.commissionPctOverride === undefined
            ? undefined
            : dto.commissionPctOverride,
      },
    });
    return {
      id: updated.id,
      verified: updated.verified,
      active: updated.active,
      commissionPctOverride: updated.commissionPctOverride ?? null,
    };
  }

  // ─── Orders ────────────────────────────────────────────────────────────

  async listOrders(status?: string, page = 1, limit = 30) {
    const skip = (page - 1) * limit;
    const where = status ? { status: status as any } : {};
    const [orders, total] = await Promise.all([
      this.prisma.marketplaceOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { items: true },
      }),
      this.prisma.marketplaceOrder.count({ where }),
    ]);
    return {
      items: orders.map((o) => this.serializeOrder(o)),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  /**
   * After an admin has transferred an owed payout to a vendor manually (because
   * that vendor had no Paystack subaccount at checkout), mark the order's owed
   * lines as paid out so they stop showing as outstanding.
   */
  async settleOwed(orderId: string) {
    const order = await this.prisma.marketplaceOrder.findUnique({
      where: { id: orderId },
      select: { id: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    const res = await this.prisma.marketplaceOrderItem.updateMany({
      where: { orderId, payoutStatus: 'OWED' },
      data: { payoutStatus: 'PAID_OUT' },
    });
    return { settled: res.count };
  }

  // ─── Summary ───────────────────────────────────────────────────────────

  /** Headline numbers for the admin dashboard. */
  async summary() {
    const paidStatuses = ['PAID', 'FULFILLED', 'DISPUTED', 'REFUNDED'] as const;

    const [stores, activeStores, openDisputes, paidItems, orderAgg] =
      await Promise.all([
        this.prisma.marketplaceStore.count(),
        this.prisma.marketplaceStore.count({ where: { active: true } }),
        this.prisma.marketplaceDispute.count({ where: { status: 'OPEN' } }),
        this.prisma.marketplaceOrderItem.findMany({
          where: { order: { status: { in: paidStatuses as any } } },
          select: {
            unitPrice: true,
            quantity: true,
            commissionNaira: true,
            vendorNetNaira: true,
            payoutStatus: true,
          },
        }),
        this.prisma.marketplaceOrder.aggregate({
          where: { status: { in: paidStatuses as any } },
          _sum: { refundedNaira: true },
          _count: true,
        }),
      ]);

    const gmv = paidItems.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
    const commission = paidItems.reduce((s, i) => s + i.commissionNaira, 0);
    const owedPayouts = paidItems
      .filter((i) => i.payoutStatus === 'OWED')
      .reduce((s, i) => s + i.vendorNetNaira, 0);
    const paidOut = paidItems
      .filter((i) => i.payoutStatus === 'PAID_OUT')
      .reduce((s, i) => s + i.vendorNetNaira, 0);

    return {
      stores,
      activeStores,
      openDisputes,
      paidOrders: orderAgg._count,
      gmvNaira: gmv,
      commissionNaira: commission,
      vendorPaidOutNaira: paidOut,
      vendorOwedNaira: owedPayouts,
      refundedNaira: orderAgg._sum.refundedNaira ?? 0,
    };
  }

  private serializeOrder(order: any) {
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      buyerName: order.buyerName,
      buyerEmail: order.buyerEmail,
      buyerPhone: order.buyerPhone,
      subtotal: order.subtotal,
      deliveryFee: order.deliveryFee,
      platformFee: order.platformFee,
      total: order.total,
      refundedNaira: order.refundedNaira,
      paidAt: order.paidAt ?? undefined,
      placedAt: order.createdAt,
      hasOwedPayout: Array.isArray(order.items)
        ? order.items.some((i: any) => i.payoutStatus === 'OWED')
        : false,
      items: Array.isArray(order.items)
        ? order.items.map((it: any) => ({
            name: it.name,
            storeName: it.storeName,
            category: it.category,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            commissionPct: it.commissionPct,
            commissionNaira: it.commissionNaira,
            vendorNetNaira: it.vendorNetNaira,
            payoutStatus: it.payoutStatus,
          }))
        : [],
    };
  }
}
