import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaystackService } from '../payments/paystack.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StaffAlertsService } from '../staff-alerts/staff-alerts.service';
import { NotificationType } from '../notifications/notification-types';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator';

/**
 * Marketplace refunds and disputes.
 *
 * A buyer raises a dispute on a paid order; an admin with MANAGE_MARKETPLACE
 * resolves it, optionally issuing a full or partial refund through Paystack.
 * An admin can also refund an order directly, without a dispute.
 *
 * Caveat on split payments: when a vendor's share was already settled to their
 * subaccount at checkout, a Paystack refund is drawn from PropertyLoop's own
 * balance — not clawed back from the vendor automatically. The resolution note
 * records this so recovery from the vendor can be handled operationally.
 */
@Injectable()
export class MarketplaceDisputesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paystack: PaystackService,
    private readonly notifications: NotificationsService,
    private readonly staffAlerts: StaffAlertsService,
  ) {}

  // ─── Buyer ──────────────────────────────────────────────────────────────

  /**
   * A buyer opens a dispute on one of their paid orders. Identified by order
   * number: a signed-in buyer must own the order; a guest order (no linked
   * account) can be disputed by anyone holding its number, matching how the
   * confirmation page is read.
   */
  async raise(
    orderNumber: string,
    dto: { reason: string; details: string },
    user?: CurrentUserData,
  ) {
    const order = await this.prisma.marketplaceOrder.findUnique({
      where: { orderNumber },
      include: { items: true, disputes: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.buyerUserId && (!user || order.buyerUserId !== user.id)) {
      throw new NotFoundException('Order not found');
    }
    if (order.status !== 'PAID' && order.status !== 'FULFILLED') {
      throw new BadRequestException(
        'Only a paid order can be disputed.',
      );
    }
    if (order.disputes.some((d) => d.status === 'OPEN')) {
      throw new BadRequestException(
        'A dispute on this order is already open.',
      );
    }

    const dispute = await this.prisma.$transaction(async (tx) => {
      const d = await tx.marketplaceDispute.create({
        data: {
          orderId: order.id,
          raisedByUserId: order.buyerUserId,
          reason: dto.reason.trim().slice(0, 120),
          details: dto.details.trim().slice(0, 2000),
        },
      });
      await tx.marketplaceOrder.update({
        where: { id: order.id },
        data: { status: 'DISPUTED' },
      });
      return d;
    });

    // Tell the vendors whose goods are in the order, and the marketplace admin.
    const vendorIds = [...new Set(order.items.map((i) => i.vendorUserId))];
    for (const vendorUserId of vendorIds) {
      void this.notifications.notify({
        userId: vendorUserId,
        type: NotificationType.MARKETPLACE_DISPUTE_OPENED,
        title: 'Order disputed',
        body: `${order.buyerName} opened a dispute on order ${order.orderNumber}: ${dispute.reason}. Our team will review it.`,
        data: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          disputeId: dispute.id,
        },
      });
    }
    this.staffAlerts.marketplaceDisputeOpened(order.orderNumber, dispute.reason);

    return this.serializeDispute(dispute, order);
  }

  // ─── Admin ──────────────────────────────────────────────────────────────

  async list(status?: string) {
    const disputes = await this.prisma.marketplaceDispute.findMany({
      where: status ? { status: status as any } : undefined,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: { order: { include: { items: true } } },
    });
    return disputes.map((d) => this.serializeDispute(d, d.order));
  }

  /**
   * Admin resolves a dispute. `action: 'refund'` issues a Paystack refund (full
   * when refundNaira is omitted, else partial) and marks the order REFUNDED;
   * `action: 'reject'` closes it with no money moved and returns the order to
   * PAID.
   */
  async resolve(
    disputeId: string,
    staffId: string,
    dto: { action: 'refund' | 'reject'; refundNaira?: number; note?: string },
  ) {
    const dispute = await this.prisma.marketplaceDispute.findUnique({
      where: { id: disputeId },
      include: { order: { include: { items: true } } },
    });
    if (!dispute) throw new NotFoundException('Dispute not found');
    if (dispute.status !== 'OPEN') {
      throw new BadRequestException('This dispute is already resolved.');
    }

    if (dto.action === 'reject') {
      await this.prisma.$transaction([
        this.prisma.marketplaceDispute.update({
          where: { id: disputeId },
          data: {
            status: 'RESOLVED_REJECTED',
            resolvedByStaffId: staffId,
            resolutionNote: dto.note?.trim().slice(0, 2000) || null,
            resolvedAt: new Date(),
          },
        }),
        this.prisma.marketplaceOrder.update({
          where: { id: dispute.orderId },
          data: { status: 'PAID' },
        }),
      ]);
      if (dispute.raisedByUserId) {
        void this.notifications.notify({
          userId: dispute.raisedByUserId,
          type: NotificationType.MARKETPLACE_DISPUTE_RESOLVED,
          title: 'Dispute reviewed',
          body: `We reviewed your dispute on order ${dispute.order.orderNumber} and could not approve a refund.${dto.note ? ` Note: ${dto.note}` : ''}`,
          data: {
            orderId: dispute.orderId,
            orderNumber: dispute.order.orderNumber,
            disputeId,
          },
        });
      }
      const updated = await this.prisma.marketplaceDispute.findUnique({
        where: { id: disputeId },
        include: { order: { include: { items: true } } },
      });
      return this.serializeDispute(updated!, updated!.order);
    }

    // Refund path.
    const refunded = await this.refundOrder(dispute.orderId, {
      refundNaira: dto.refundNaira,
      reason: dto.note,
      staffId,
    });

    await this.prisma.marketplaceDispute.update({
      where: { id: disputeId },
      data: {
        status: 'RESOLVED_REFUND',
        resolvedByStaffId: staffId,
        resolutionNote: dto.note?.trim().slice(0, 2000) || null,
        refundNaira: refunded.refundNaira,
        resolvedAt: new Date(),
      },
    });

    if (dispute.raisedByUserId) {
      void this.notifications.notify({
        userId: dispute.raisedByUserId,
        type: NotificationType.MARKETPLACE_DISPUTE_RESOLVED,
        title: 'Refund approved',
        body: `We refunded ₦${refunded.refundNaira.toLocaleString('en-NG')} on order ${dispute.order.orderNumber}. It returns to your payment method shortly.`,
        data: {
          orderId: dispute.orderId,
          orderNumber: dispute.order.orderNumber,
          disputeId,
        },
      });
    }

    const updated = await this.prisma.marketplaceDispute.findUnique({
      where: { id: disputeId },
      include: { order: { include: { items: true } } },
    });
    return this.serializeDispute(updated!, updated!.order);
  }

  /**
   * Refund an order through Paystack and record it. Shared by dispute
   * resolution and admin-initiated refunds. A full refund (refundNaira omitted)
   * refunds everything still unrefunded and marks every line REFUNDED; a
   * partial refund tops up refundedNaira without touching per-line payout state
   * (which vendor's share to claw back is an operational call).
   */
  async refundOrder(
    orderId: string,
    opts: { refundNaira?: number; reason?: string; staffId?: string },
  ) {
    const order = await this.prisma.marketplaceOrder.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status === 'PENDING' || order.status === 'CANCELLED') {
      throw new BadRequestException('This order was never paid.');
    }

    const remaining = order.total - order.refundedNaira;
    if (remaining <= 0) {
      throw new BadRequestException('This order is already fully refunded.');
    }

    const isFull =
      opts.refundNaira === undefined || opts.refundNaira >= remaining;
    const refundNaira = isFull ? remaining : Math.max(1, opts.refundNaira!);
    if (refundNaira > remaining) {
      throw new BadRequestException(
        `At most ₦${remaining.toLocaleString('en-NG')} can still be refunded.`,
      );
    }

    // Issue the refund with Paystack. A failure here must not record a refund
    // that did not happen.
    try {
      await this.paystack.refundTransaction(
        order.paystackRef,
        refundNaira * 100,
      );
    } catch (error: any) {
      throw new BadRequestException(
        `Paystack refund failed: ${error.response?.data?.message || error.message}`,
      );
    }

    await this.prisma.$transaction([
      this.prisma.marketplaceOrder.update({
        where: { id: orderId },
        data: {
          status: 'REFUNDED',
          refundedNaira: order.refundedNaira + refundNaira,
          refundedAt: new Date(),
        },
      }),
      ...(isFull
        ? [
            this.prisma.marketplaceOrderItem.updateMany({
              where: { orderId },
              data: { payoutStatus: 'REFUNDED' },
            }),
          ]
        : []),
    ]);

    // Let the buyer know (dispute path sends its own richer message; this fires
    // for an admin-initiated refund without a dispute).
    if (order.buyerUserId) {
      void this.notifications.notify({
        userId: order.buyerUserId,
        type: NotificationType.MARKETPLACE_ORDER_REFUNDED,
        title: 'Refund issued',
        body: `₦${refundNaira.toLocaleString('en-NG')} was refunded on order ${order.orderNumber}.`,
        data: { orderId, orderNumber: order.orderNumber },
      });
    }

    console.log(
      `Marketplace refund: order ${order.orderNumber} refunded ${refundNaira} (full=${isFull}) by staff ${opts.staffId ?? 'system'}`,
    );

    return { refundNaira, full: isFull };
  }

  // ─── Serialize ────────────────────────────────────────────────────────────

  private serializeDispute(dispute: any, order: any) {
    return {
      id: dispute.id,
      status: dispute.status,
      reason: dispute.reason,
      details: dispute.details,
      refundNaira: dispute.refundNaira,
      resolutionNote: dispute.resolutionNote ?? undefined,
      resolvedAt: dispute.resolvedAt ?? undefined,
      createdAt: dispute.createdAt,
      order: order
        ? {
            id: order.id,
            orderNumber: order.orderNumber,
            buyerName: order.buyerName,
            buyerEmail: order.buyerEmail,
            total: order.total,
            refundedNaira: order.refundedNaira,
            status: order.status,
            items: Array.isArray(order.items)
              ? order.items.map((it: any) => ({
                  name: it.name,
                  storeName: it.storeName,
                  quantity: it.quantity,
                  unitPrice: it.unitPrice,
                }))
              : [],
          }
        : undefined,
    };
  }
}
