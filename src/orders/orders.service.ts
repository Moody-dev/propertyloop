import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateOrderDto) {
    // Fetch all products referenced in the order
    const productIds = dto.items.map((i) => i.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
    });
    if (products.length !== productIds.length) {
      throw new BadRequestException('One or more products not found');
    }

    const productMap = new Map(products.map((p) => [p.id, p]));

    // Calculate pricing
    const orderItems = dto.items.map((item) => {
      const product = productMap.get(item.productId)!;
      return {
        productId: product.id,
        name: product.name,
        supplier: product.supplier,
        image: product.coverImage,
        priceLabel: product.priceLabel,
        unit: product.unit,
        unitPrice: product.priceNaira,
        quantity: item.quantity,
      };
    });

    const subtotal = orderItems.reduce(
      (sum, item) => sum + item.unitPrice * item.quantity,
      0,
    );
    const deliveryFee = subtotal > 0 ? 15000 : 0;
    const serviceFee = Math.round(subtotal * 0.03);
    const total = subtotal + deliveryFee + serviceFee;

    const orderNumber = `MAT-${Date.now().toString().slice(-8)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

    const order = await this.prisma.order.create({
      data: {
        orderNumber,
        userId,
        recipientName: dto.recipientName,
        phone: dto.phone,
        address: dto.address,
        city: dto.city,
        notes: dto.notes,
        subtotal,
        deliveryFee,
        serviceFee,
        total,
        payMethod: dto.payMethod,
        items: {
          create: orderItems,
        },
      },
      include: { items: true },
    });

    return order;
  }

  async listForBuyer(userId: string, page = 1, limit = 24) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where: { userId },
        orderBy: { placedAt: 'desc' },
        skip,
        take: limit,
        include: { items: true },
      }),
      this.prisma.order.count({ where: { userId } }),
    ]);
    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async getById(orderId: string, userId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.userId !== userId) {
      throw new ForbiddenException('You can only view your own orders');
    }
    return order;
  }

  async getByOrderNumber(orderNumber: string, userId: string) {
    const order = await this.prisma.order.findUnique({
      where: { orderNumber },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.userId !== userId) {
      throw new ForbiddenException('You can only view your own orders');
    }
    return order;
  }
}
