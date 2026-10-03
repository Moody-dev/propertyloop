import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  Prisma,
  Role,
  ConversationParticipantRole,
} from '../../generated/prisma/client';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import {
  ListConversationsDto,
  ListMessagesDto,
} from './dto/list-conversations.dto';
import { ChatGateway } from './chat.gateway';
import { assertNotObjectionable } from '../common/content-filter';
import { HouseEnquiryService } from '../stock-alerts/house-enquiry.service';

// Admin identities are masked behind the PropertyLoop brand when shown to
// non-admin users so support/system messages appear to come from the
// company, not from an individual staff member.
const PROPERTYLOOP_NAME = 'PropertyLoop';
const PROPERTYLOOP_AVATAR =
  'https://image2url.com/r2/default/images/1774405533651-13ef5a22-bfcb-4d8e-801e-563f4451c8b0.png';

function mapToConversationRole(role: Role): ConversationParticipantRole {
  switch (role) {
    case Role.AGENT:
      return ConversationParticipantRole.AGENT;
    case Role.VENDOR:
      return ConversationParticipantRole.VENDOR;
    case Role.ADMIN:
      return ConversationParticipantRole.ADMIN;
    default:
      return ConversationParticipantRole.BUYER;
  }
}

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => ChatGateway))
    private readonly chatGateway: ChatGateway,
    // Optional so an existing unit test can build this with Prisma alone.
    @Optional() private readonly houseEnquiry?: HouseEnquiryService,
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
    const unreadMap = new Map(
      participantRows.map((p) => [p.conversationId, p.unreadCount]),
    );

    if (convoIds.length === 0) {
      return { items: [], total: 0, page, limit, pages: 0 };
    }

    // Blocking (either direction) removes the conversation from view
    // instantly — the blocker no longer wants to see it, and the blocked
    // party can no longer send into it anyway (App Store guideline 1.2).
    const blockedOtherIds = await this.blockedCounterpartIds(userId);
    const where: Prisma.ConversationWhereInput = {
      id: { in: convoIds },
      // Internal staff conversations must never surface here. A staff member
      // who is also an agent participates in both kinds, and without this
      // filter their team threads would appear in the customer inbox
      // alongside buyer enquiries.
      isInternal: false,
      // A conversation row is created the moment someone opens a chat, before
      // any message is sent (see createOrFind). Both sides were then listing
      // that empty shell as "No messages yet" — so you appeared in someone's
      // inbox purely because they tapped Message on your profile and backed
      // out. Nothing to show until it actually carries a message.
      messages: { some: {} },
      ...(blockedOtherIds.length > 0 && {
        participants: { none: { userId: { in: blockedOtherIds } } },
      }),
    };

    const [conversations, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
        include: {
          participants: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  avatarUrl: true,
                  phone: true,
                  role: true,
                },
              },
            },
          },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      }),
      this.prisma.conversation.count({ where }),
    ]);

    const items = conversations.map((c) => {
      const other = c.participants.find((p) => p.userId !== userId);
      const lastMsg = c.messages[0];
      // Mask off the authoritative USER role, not the denormalised participant
      // role — the latter can be stale/wrong (e.g. an admin added to an old
      // conversation with a BUYER participant role), which would leak the
      // admin's real name as the conversation title instead of "PropertyLoop".
      const otherIsAdmin = other?.user.role === 'ADMIN';
      return {
        id: c.id,
        listingId: c.listingId,
        productId: c.productId,
        // The other person's info — admins are shown as PropertyLoop
        name: otherIsAdmin ? PROPERTYLOOP_NAME : other?.user.name || 'Unknown',
        avatar: otherIsAdmin
          ? PROPERTYLOOP_AVATAR
          : other?.user.avatarUrl || null,
        phone: otherIsAdmin ? null : other?.user.phone || null,
        role: other?.role || 'BUYER',
        otherUserId: other?.userId || null,
        // Last message preview
        lastMessage: lastMsg?.text || '',
        lastMessageAt:
          lastMsg?.createdAt?.toISOString() || c.updatedAt.toISOString(),
        lastMessageIsYou: lastMsg?.senderUserId === userId,
        // Unread
        unread: unreadMap.get(c.id) || 0,
        updatedAt: c.updatedAt.toISOString(),
      };
    });

    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  // ─── Get messages for a conversation ─────────────────────────────────────

  async getMessages(
    userId: string,
    conversationId: string,
    dto: ListMessagesDto,
  ) {
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
          select: { id: true, name: true, avatarUrl: true, role: true },
        },
      },
    });

    // Mark as read (and let the other side flip ✓ → ✓✓ live).
    const readAt = new Date();
    await this.prisma.conversationParticipant.updateMany({
      where: { conversationId, userId },
      data: { unreadCount: 0, lastReadAt: readAt },
    });
    this.chatGateway.broadcastMessagesRead(conversationId, userId, readAt);

    // The other side's lastReadAt drives read receipts on the viewer's own
    // messages: read once their read marker is past the message's createdAt.
    const others = await this.prisma.conversationParticipant.findMany({
      where: { conversationId, userId: { not: userId } },
      select: { lastReadAt: true },
    });
    const otherReadAt = others.reduce<Date | null>(
      (max, p) =>
        p.lastReadAt && (!max || p.lastReadAt > max) ? p.lastReadAt : max,
      null,
    );

    // Resolve the viewer's role so we know whether to mask admin senders.
    // Admins themselves should see real names; everyone else sees PropertyLoop.
    const viewer = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    const viewerIsAdmin = viewer?.role === 'ADMIN';

    return messages.reverse().map((m) => {
      const senderIsAdmin = m.sender.role === 'ADMIN';
      const mask = senderIsAdmin && !viewerIsAdmin;
      const isYou = m.senderUserId === userId;
      return {
        id: m.id,
        conversationId: m.conversationId,
        senderUserId: m.senderUserId,
        senderName: mask ? PROPERTYLOOP_NAME : m.sender.name,
        senderAvatar: mask ? PROPERTYLOOP_AVATAR : m.sender.avatarUrl,
        isYou,
        text: m.text,
        attachmentUrls: m.attachmentUrls,
        createdAt: m.createdAt.toISOString(),
        // Only meaningful on your own messages; others' are read by definition.
        read: isYou ? !!otherReadAt && m.createdAt <= otherReadAt : true,
      };
    });
  }

  // ─── Send a message ──────────────────────────────────────────────────────

  async sendMessage(
    userId: string,
    conversationId: string,
    dto: SendMessageDto,
  ) {
    await this.assertParticipant(userId, conversationId);

    if (!dto.text?.trim() && !dto.attachmentUrls?.length) {
      throw new BadRequestException('Message must have text or attachments');
    }
    assertNotObjectionable(dto.text, 'Your message');

    // If either side has blocked the other, the conversation is dead — a
    // blocked user must not be able to keep messaging the person who blocked
    // them (App Store guideline 1.2).
    const others = await this.prisma.conversationParticipant.findMany({
      where: { conversationId, userId: { not: userId } },
      select: { userId: true },
    });
    if (others.length > 0) {
      const blocked = await this.prisma.blockedUser.findFirst({
        where: {
          OR: others.map((o) => ({
            OR: [
              { blockerId: userId, blockedId: o.userId },
              { blockerId: o.userId, blockedId: userId },
            ],
          })),
        },
      });
      if (blocked) {
        throw new ForbiddenException(
          'You can no longer message this conversation.',
        );
      }
    }

    const message = await this.prisma.message.create({
      data: {
        conversationId,
        senderUserId: userId,
        text: dto.text ?? '',
        attachmentUrls: dto.attachmentUrls ?? [],
      },
      include: {
        sender: {
          select: { id: true, name: true, avatarUrl: true, role: true },
        },
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

    const senderIsAdmin = message.sender.role === 'ADMIN';

    const payload = {
      id: message.id,
      conversationId: message.conversationId,
      senderUserId: message.senderUserId,
      senderName: message.sender.name,
      senderAvatar: message.sender.avatarUrl,
      text: message.text,
      attachmentUrls: message.attachmentUrls,
      createdAt: message.createdAt.toISOString(),
      read: false,
    };

    await this.chatGateway.broadcastNewMessage(conversationId, payload, {
      senderIsAdmin,
      maskedName: PROPERTYLOOP_NAME,
      maskedAvatar: PROPERTYLOOP_AVATAR,
    });

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
    if (recipient.id === userId)
      throw new BadRequestException('Cannot message yourself');
    assertNotObjectionable(dto.text, 'Your message');

    const blocked = await this.prisma.blockedUser.findFirst({
      where: {
        OR: [
          { blockerId: userId, blockedId: recipient.id },
          { blockerId: recipient.id, blockedId: userId },
        ],
      },
    });
    if (blocked) {
      throw new ForbiddenException('You can no longer message this user.');
    }

    // Check if conversation already exists between these two users
    const existingParticipants =
      await this.prisma.conversationParticipant.findMany({
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
          await this.sendMessage(userId, existing.conversationId, {
            text: dto.text,
          });
        }
        await this.noteHouseEnquiry(userId, dto.listingId, dto.text);
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
              select: {
                id: true,
                name: true,
                avatarUrl: true,
                phone: true,
                role: true,
              },
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

    await this.noteHouseEnquiry(userId, dto.listingId, dto.text);
    return { conversationId: conversation.id, created: true };
  }

  /**
   * Find-or-create the current user's support conversation with PropertyLoop.
   * The client never needs to know an admin's id — we resolve the support
   * admin server-side and reuse createOrFind so admins are masked behind the
   * PropertyLoop brand in the chat like any other admin conversation.
   */
  /**
   * A message about PropertyLoop's own stock is an enquiry the team has to
   * answer, not a private chat with the staff member who filed the property.
   * Does nothing for an agent's own listing, or a conversation about a product.
   */
  private async noteHouseEnquiry(
    userId: string,
    listingId?: string,
    text?: string,
  ) {
    if (!listingId || !this.houseEnquiry) return;
    const sender = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, phone: true, email: true },
    });
    this.houseEnquiry.record({
      listingId,
      kind: 'MESSAGE',
      name: sender?.name ?? 'Someone',
      phone: sender?.phone,
      email: sender?.email,
      message: text,
      buyerUserId: userId,
    });
  }

  async startSupport(userId: string) {
    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!me) throw new NotFoundException('User not found');

    // If the user already has a support thread (any conversation whose other
    // participant is an admin), open that one — never spin up a duplicate,
    // even if a different admin replied. Most-recently-active wins.
    const existing = await this.prisma.conversationParticipant.findFirst({
      where: {
        userId: { not: userId },
        user: { role: Role.ADMIN },
        conversation: { participants: { some: { userId } } },
      },
      orderBy: { conversation: { updatedAt: 'desc' } },
      select: { conversationId: true },
    });
    if (existing) {
      return { conversationId: existing.conversationId, created: false };
    }

    // Otherwise create one with the designated support account = earliest admin.
    const admin = await this.prisma.user.findFirst({
      where: { role: Role.ADMIN, isActive: true, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!admin) {
      throw new NotFoundException('Support is unavailable right now.');
    }

    const result = await this.createOrFind(userId, {
      recipientId: admin.id,
      recipientRole: ConversationParticipantRole.ADMIN,
      senderRole: mapToConversationRole(me.role),
    });

    // Greet the user from PropertyLoop the first time so the chat opens warm
    // instead of blank. Sent from the admin, so it's masked as PropertyLoop.
    if (result.created) {
      await this.sendMessage(admin.id, result.conversationId, {
        text: 'Hi 👋 Welcome to PropertyLoop support. Tell us what you need help with — you can attach a photo or document too. We usually reply within a few minutes.',
      });
    }

    return result;
  }

  // ─── Mark conversation as read ───────────────────────────────────────────

  async markRead(userId: string, conversationId: string) {
    await this.assertParticipant(userId, conversationId);
    const readAt = new Date();
    await this.prisma.conversationParticipant.updateMany({
      where: { conversationId, userId },
      data: { unreadCount: 0, lastReadAt: readAt },
    });
    // Let the other side flip their ✓ to ✓✓ live.
    this.chatGateway.broadcastMessagesRead(conversationId, userId, readAt);
    return { success: true, readAt: readAt.toISOString() };
  }

  // ─── Get total unread count ──────────────────────────────────────────────

  async getUnreadCount(userId: string) {
    // Must apply the same visibility rules as listConversations, or the badge
    // counts a conversation the inbox hides — an unread the user can never
    // clear because there is nothing to open.
    const blockedOtherIds = await this.blockedCounterpartIds(userId);

    const result = await this.prisma.conversationParticipant.aggregate({
      where: {
        userId,
        conversation: {
          // Same visibility rules as listConversations, internal threads
          // included: a staff member's team unreads belong on the team
          // portal's badge, not the customer inbox's.
          isInternal: false,
          messages: { some: {} },
          ...(blockedOtherIds.length > 0 && {
            participants: { none: { userId: { in: blockedOtherIds } } },
          }),
        },
      },
      _sum: { unreadCount: true },
    });
    return { unread: result._sum.unreadCount ?? 0 };
  }

  /** Users on either side of a block with this user — hidden from their inbox. */
  private async blockedCounterpartIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.blockedUser.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      select: { blockerId: true, blockedId: true },
    });
    return rows.map((r) =>
      r.blockerId === userId ? r.blockedId : r.blockerId,
    );
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async assertParticipant(userId: string, conversationId: string) {
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!participant) {
      throw new ForbiddenException(
        'You are not a participant in this conversation',
      );
    }
    return participant;
  }
}
