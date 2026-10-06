import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaystackService } from '../payments/paystack.service';
import { PaymentsService } from '../payments/payments.service';
import { CreateMarketplaceOrderDto } from './dto/create-order.dto';
import {
  commissionFor,
  deliveryFeeFor,
  platformFeeFor,
} from './marketplace.constants';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator';

@Injectable()
export class MarketplaceOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paystack: PaystackService,
    private readonly payments: PaymentsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Create a PENDING order from server-trusted prices and open a Paystack
   * checkout for it. The client never dictates the amount — every price, fee
   * and commission is recomputed here from the database, so a tampered cart
   * can't change what is charged or what a vendor is owed.
   */
  async createAndInitialize(
    dto: CreateMarketplaceOrderDto,
    user?: CurrentUserData,
  ) {
    if (!dto.items.length) {
      throw new BadRequestException('Your cart is empty.');
    }

    // One product per id — collapse duplicate lines the client may have sent.
    const quantities = new Map<string, number>();
    const optionsById = new Map<string, Record<string, string> | undefined>();
    for (const item of dto.items) {
      quantities.set(
        item.productId,
        (quantities.get(item.productId) ?? 0) + item.quantity,
      );
      if (item.options) optionsById.set(item.productId, item.options);
    }

    const productIds = [...quantities.keys()];
    const products = await this.prisma.marketplaceProduct.findMany({
      where: { id: { in: productIds }, active: true },
      include: { store: true },
    });

    if (products.length !== productIds.length) {
      throw new BadRequestException(
        'One or more items are no longer available.',
      );
    }

    const soldOut = products.find((p) => !p.inStock || !p.store.active);
    if (soldOut) {
      throw new BadRequestException(`"${soldOut.name}" is out of stock.`);
    }

    // Build order items with per-line commission snapshots.
    const itemsData = products.map((p) => {
      const quantity = quantities.get(p.id)!;
      const lineTotal = p.priceNaira * quantity;
      const commissionPct = p.store.commissionPct;
      const commissionNaira = commissionFor(lineTotal, commissionPct);
      return {
        productId: p.id,
        storeId: p.storeId,
        name: p.name,
        image: p.coverImage,
        storeName: p.store.name,
        vendorUserId: p.store.ownerUserId,
        unitPrice: p.priceNaira,
        quantity,
        options: optionsById.get(p.id) ?? undefined,
        commissionPct,
        commissionNaira,
        vendorNetNaira: lineTotal - commissionNaira,
      };
    });

    const subtotal = itemsData.reduce(
      (sum, it) => sum + it.unitPrice * it.quantity,
      0,
    );
    const deliveryFee = deliveryFeeFor(subtotal);
    const platformFee = platformFeeFor(subtotal);
    const total = subtotal + deliveryFee + platformFee;

    const orderNumber = this.makeOrderNumber();
    // Reference and order number share a value: it is unique, traceable in the
    // Paystack dashboard, and lets the webhook find the order directly.
    const reference = orderNumber;

    const order = await this.prisma.marketplaceOrder.create({
      data: {
        orderNumber,
        paystackRef: reference,
        buyerUserId: user?.id ?? null,
        buyerName: dto.buyerName.trim(),
        buyerEmail: dto.buyerEmail.trim().toLowerCase(),
        buyerPhone: dto.buyerPhone.trim(),
        address: dto.address.trim(),
        city: dto.city.trim(),
        state: dto.state.trim(),
        notes: dto.notes?.trim() || null,
        subtotal,
        deliveryFee,
        platformFee,
        total,
        status: 'PENDING',
        items: { create: itemsData },
      },
      include: { items: true },
    });

    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') || 'http://localhost:5173';
    const callbackUrl =
      dto.returnUrl && dto.returnUrl.trim()
        ? this.paystack.buildMobileReturnUrl(dto.returnUrl.trim())
        : `${frontendUrl}/marketplace/order/${orderNumber}`;

    try {
      const { authorization_url } = await this.paystack.initializeTransaction({
        email: order.buyerEmail,
        amount: total * 100, // kobo
        reference,
        callback_url: callbackUrl,
        metadata: {
          type: 'marketplace_order',
          orderId: order.id,
          orderNumber,
        },
      });

      return {
        orderNumber,
        reference,
        paymentUrl: authorization_url,
        total,
      };
    } catch {
      // Initialization failed — drop the dangling PENDING order so a retry
      // starts clean rather than leaving an unpayable shell behind.
      await this.prisma.marketplaceOrder
        .delete({ where: { id: order.id } })
        .catch(() => undefined);
      throw new BadRequestException(
        'We could not start the payment. Please try again.',
      );
    }
  }

  /**
   * Called on the buyer's return from Paystack. Verifies the charge (idempotent
   * with the webhook) and returns the order so the confirmation page can render
   * without waiting on the webhook.
   */
  async verifyAndGet(reference: string, user?: CurrentUserData) {
    await this.payments.handleMarketplaceChargeSuccess(reference);
    const order = await this.prisma.marketplaceOrder.findUnique({
      where: { paystackRef: reference },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    // Guests can read their own order by reference (it is unguessable); signed-in
    // buyers never see someone else's.
    if (order.buyerUserId && user && order.buyerUserId !== user.id) {
      throw new NotFoundException('Order not found');
    }
    return this.serialize(order);
  }

  async listForBuyer(userId: string, page = 1, limit = 24) {
    const skip = (page - 1) * limit;
    const [orders, total] = await Promise.all([
      this.prisma.marketplaceOrder.findMany({
        where: { buyerUserId: userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { items: true },
      }),
      this.prisma.marketplaceOrder.count({ where: { buyerUserId: userId } }),
    ]);
    return {
      items: orders.map((o) => this.serialize(o)),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  // ─── Vendor views ─────────────────────────────────────────────────────────

  /** Paid orders that contain at least one of this vendor's items. */
  async listForVendor(vendorUserId: string, page = 1, limit = 24) {
    const skip = (page - 1) * limit;
    const where: Prisma.MarketplaceOrderWhereInput = {
      status: { in: ['PAID', 'FULFILLED'] },
      items: { some: { vendorUserId } },
    };
    const [orders, total] = await Promise.all([
      this.prisma.marketplaceOrder.findMany({
        where,
        orderBy: { paidAt: 'desc' },
        skip,
        take: limit,
        // Only this vendor's lines — one buyer order can span several stores.
        include: { items: { where: { vendorUserId } } },
      }),
      this.prisma.marketplaceOrder.count({ where }),
    ]);
    return {
      items: orders.map((o) => this.serialize(o)),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  /** What the vendor has earned across paid marketplace orders. */
  async earningsForVendor(vendorUserId: string) {
    const rows = await this.prisma.marketplaceOrderItem.findMany({
      where: {
        vendorUserId,
        order: { status: { in: ['PAID', 'FULFILLED'] } },
      },
      select: {
        orderId: true,
        vendorNetNaira: true,
        commissionNaira: true,
        quantity: true,
        unitPrice: true,
      },
    });
    const gross = rows.reduce((s, r) => s + r.unitPrice * r.quantity, 0);
    const commission = rows.reduce((s, r) => s + r.commissionNaira, 0);
    const net = rows.reduce((s, r) => s + r.vendorNetNaira, 0);
    return {
      orders: new Set(rows.map((r) => r.orderId)).size,
      lineItems: rows.length,
      grossNaira: gross,
      commissionNaira: commission,
      netNaira: net,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private makeOrderNumber(): string {
    const stamp = Date.now().toString().slice(-8);
    const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
    return `PLM-${stamp}-${rand}`;
  }

  private serialize(order: any) {
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      reference: order.paystackRef,
      status: order.status,
      buyerName: order.buyerName,
      buyerEmail: order.buyerEmail,
      buyerPhone: order.buyerPhone,
      address: order.address,
      city: order.city,
      state: order.state,
      notes: order.notes ?? undefined,
      subtotal: order.subtotal,
      deliveryFee: order.deliveryFee,
      platformFee: order.platformFee,
      total: order.total,
      paidAt: order.paidAt ?? undefined,
      placedAt: order.createdAt,
      items: Array.isArray(order.items)
        ? order.items.map((it: any) => ({
            productId: it.productId,
            storeId: it.storeId,
            storeName: it.storeName,
            name: it.name,
            image: it.image,
            unitPrice: it.unitPrice,
            quantity: it.quantity,
            options: it.options ?? undefined,
            lineTotal: it.unitPrice * it.quantity,
          }))
        : [],
    };
  }
}
