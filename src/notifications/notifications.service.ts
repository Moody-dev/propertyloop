import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ExpoPushService } from './expo-push.service';
import { ListNotificationsDto } from './dto/list-notifications.dto';

export interface CreateNotificationInput {
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** Set false to skip the push (in-app only). Defaults to true. */
  push?: boolean;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly expo: ExpoPushService,
  ) {}

  // ─── Emit (called by other modules) ──────────────────────────────────────

  /**
   * Persist an in-app notification and (best-effort) fire an Expo push to the
   * user's devices. Never throws — a notification failure must not break the
   * business action that triggered it.
   */
  async notify(input: CreateNotificationInput) {
    let notification;
    try {
      notification = await this.prisma.notification.create({
        data: {
          userId: input.userId,
          type: input.type,
          title: input.title,
          body: input.body,
          data: (input.data ?? undefined) as
            | Prisma.InputJsonValue
            | undefined,
        },
      });
    } catch (err) {
      this.logger.error(`Failed to persist notification: ${(err as Error).message}`);
      return null;
    }

    if (input.push !== false) {
      void this.pushToUser(input.userId, input.title, input.body, input.data);
    }
    return notification;
  }

  private async pushToUser(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, unknown>,
  ) {
    try {
      const tokens = await this.prisma.pushToken.findMany({
        where: { userId },
        select: { token: true },
      });
      if (tokens.length === 0) return;

      const { deadTokens } = await this.expo.send(
        tokens.map((t) => ({ to: t.token, title, body, data })),
      );
      if (deadTokens.length > 0) {
        await this.prisma.pushToken.deleteMany({
          where: { token: { in: deadTokens } },
        });
      }
    } catch (err) {
      this.logger.warn(`pushToUser failed: ${(err as Error).message}`);
    }
  }

  // ─── Feed (read) ─────────────────────────────────────────────────────────

  async list(userId: string, dto: ListNotificationsDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 30;
    const skip = (page - 1) * limit;

    const where = { userId, ...(dto.unread ? { readAt: null } : {}) };

    const [items, total, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);

    return {
      items,
      total,
      unread,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  async unreadCount(userId: string) {
    const count = await this.prisma.notification.count({
      where: { userId, readAt: null },
    });
    return { unread: count };
  }

  async markRead(userId: string, id: string) {
    // Scope by userId so a user can't mark someone else's notification.
    await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { success: true };
  }

  async markAllRead(userId: string) {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { success: true, updated: count };
  }

  // ─── Push tokens ─────────────────────────────────────────────────────────

  async registerToken(userId: string, token: string, platform?: string) {
    // Upsert by token. If the device previously belonged to another user
    // (shared device, re-login), reassign it to the current user.
    await this.prisma.pushToken.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform, lastUsedAt: new Date() },
    });
    return { success: true };
  }

  async removeToken(userId: string, token: string) {
    await this.prisma.pushToken.deleteMany({ where: { userId, token } });
    return { success: true };
  }
}
