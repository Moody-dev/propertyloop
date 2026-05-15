import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { ListConversationsDto, ListMessagesDto } from './dto/list-conversations.dto';
import { ChatGateway } from './chat.gateway';

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => ChatGateway))
    private readonly chatGateway: ChatGateway,
  ) {}

  // ─── List conversations for the current user ────────────────────────────

  async listConversations(userId: string, dto: ListConversationsDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 50;
    const skip = (page - 1) * limit;

    // Find all conversations the user participates in
    const participantRows = await this.prisma.conversationParticipant.findMany({
      where: { userId },
      select: { conversationId: true, unreadCount: true },
    });
    const convoIds = participantRows.map((p) => p.conversationId);
    const unreadMap = new Map(participantRows.map((p) => [p.conversationId, p.unreadCount]));

    if (convoIds.length === 0) {
      return { items: [], total: 0, page, limit, pages: 0 };
    }

    const [conversations, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where: { id: { in: convoIds } },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
        include: {
          participants: {
            include: {
              user: {
                select: { id: true, name: true, avatarUrl: true, phone: true, role: true },
              },
            },
          },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      }),
      convoIds.length,
    ]);

    const items = conversations.map((c) => {
      const other = c.participants.find((p) => p.userId !== userId);
      const lastMsg = c.messages[0];
      return {
        id: c.id,
        listingId: c.listingId,
        productId: c.productId,
        // The other person's info
        name: other?.user.name || 'Unknown',
        avatar: other?.user.avatarUrl || null,
        phone: other?.user.phone || null,
        role: other?.role || 'BUYER',
        otherUserId: other?.userId || null,
        // Last message preview
        lastMessage: lastMsg?.text || '',
        lastMessageAt: lastMsg?.createdAt?.toISOString() || c.updatedAt.toISOString(),
        lastMessageIsYou: lastMsg?.senderUserId === userId,
        // Unread
        unread: unreadMap.get(c.id) || 0,
        updatedAt: c.updatedAt.toISOString(),
      };
    });

    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  // ─── Get messages for a conversation ─────────────────────────────────────

  async getMessages(userId: string, conversationId: string, dto: ListMessagesDto) {
    // Verify user is a participant
    await this.assertParticipant(userId, conversationId);

    const limit = dto.limit ?? 100;
    const where: Prisma.MessageWhereInput = { conversationId };
    if (dto.before) {
      where.id = { lt: dto.before };
    }

    const messages = await this.prisma.message.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        sender: {
          select: { id: true, name: true, avatarUrl: true },
        },
      },
    });

    // Mark as read
    await this.prisma.conversationParticipant.updateMany({
      where: { conversationId, userId },
      data: { unreadCount: 0 },
    });

    // Return in chronological order
    return messages.reverse().map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      senderUserId: m.senderUserId,
      senderName: m.sender.name,
      senderAvatar: m.sender.avatarUrl,
      isYou: m.senderUserId === userId,
      text: m.text,
      attachmentUrls: m.attachmentUrls,
      createdAt: m.createdAt.toISOString(),
    }));
  }

  // ─── Send a message ──────────────────────────────────────────────────────

  async sendMessage(userId: string, conversationId: string, dto: SendMessageDto) {
    await this.assertParticipant(userId, conversationId);

    if (!dto.text?.trim() && !dto.attachmentUrls?.length) {
      throw new BadRequestException('Message must have text or attachments');
    }

    const message = await this.prisma.message.create({
      data: {
        conversationId,
        senderUserId: userId,
        text: dto.text ?? '',
        attachmentUrls: dto.attachmentUrls ?? [],
      },
      include: {
        sender: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    // Update conversation updatedAt
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    // Increment unread for all OTHER participants
    await this.prisma.conversationParticipant.updateMany({
      where: { conversationId, userId: { not: userId } },
      data: { unreadCount: { increment: 1 } },
    });

    const payload = {
      id: message.id,
      conversationId: message.conversationId,
      senderUserId: message.senderUserId,
      senderName: message.sender.name,
      senderAvatar: message.sender.avatarUrl,
      text: message.text,
      attachmentUrls: message.attachmentUrls,
      createdAt: message.createdAt.toISOString(),
    };

    await this.chatGateway.broadcastNewMessage(conversationId, payload);

    return { ...payload, isYou: true };
  }

  // ─── Start or find a conversation ────────────────────────────────────────

  async createOrFind(userId: string, dto: CreateConversationDto) {
    // Validate recipient exists
    const recipient = await this.prisma.user.findUnique({
      where: { id: dto.recipientId },
      select: { id: true, name: true, avatarUrl: true, phone: true },
    });
    if (!recipient) throw new NotFoundException('Recipient not found');
    if (recipient.id === userId) throw new BadRequestException('Cannot message yourself');

    // Check if conversation already exists between these two users
    const existingParticipants = await this.prisma.conversationParticipant.findMany({
      where: { userId },
      select: { conversationId: true },
    });
    const myConvoIds = existingParticipants.map((p) => p.conversationId);

    if (myConvoIds.length > 0) {
      const existing = await this.prisma.conversationParticipant.findFirst({
        where: {
          userId: dto.recipientId,
          conversationId: { in: myConvoIds },
        },
        include: { conversation: true },
      });
      if (existing) {
        // Send the first message if provided
        if (dto.text) {
          await this.sendMessage(userId, existing.conversationId, { text: dto.text });
        }
        return { conversationId: existing.conversationId, created: false };
      }
    }

    // Create new conversation with both participants
    const conversation = await this.prisma.conversation.create({
      data: {
        listingId: dto.listingId,
        productId: dto.productId,
        participants: {
          create: [
            { userId, role: dto.senderRole },
            { userId: dto.recipientId, role: dto.recipientRole },
          ],
        },
      },
      include: {
        participants: {
          include: {
            user: {
              select: { id: true, name: true, avatarUrl: true, phone: true, role: true },
            },
          },
        },
      },
    });

    // Notify all participants' connected sockets about the new conversation
    // so their UIs prepend it to the list and future per-conversation events
    // (typing, etc.) reach them without requiring a refresh.
    await this.chatGateway.notifyConversationCreated(conversation.id, [
      userId,
      dto.recipientId,
    ]);

    // Send the first message if provided
    if (dto.text) {
      await this.sendMessage(userId, conversation.id, { text: dto.text });
    }

    return { conversationId: conversation.id, created: true };
  }

  // ─── Mark conversation as read ───────────────────────────────────────────

  async markRead(userId: string, conversationId: string) {
    await this.assertParticipant(userId, conversationId);
    await this.prisma.conversationParticipant.updateMany({
      where: { conversationId, userId },
      data: { unreadCount: 0 },
    });
    return { success: true };
  }

  // ─── Get total unread count ──────────────────────────────────────────────

  async getUnreadCount(userId: string) {
    const result = await this.prisma.conversationParticipant.aggregate({
      where: { userId },
      _sum: { unreadCount: true },
    });
    return { unread: result._sum.unreadCount ?? 0 };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async assertParticipant(userId: string, conversationId: string) {
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!participant) {
      throw new ForbiddenException('You are not a participant in this conversation');
    }
    return participant;
  }
}
