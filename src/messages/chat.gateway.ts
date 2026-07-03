import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { forwardRef, Inject } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { MessagesService } from './messages.service';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';

@WebSocketGateway({
  cors: {
    origin: [
      'http://localhost:5173',
      'https://propertyloopmain.netlify.app',
      'https://property-loop.netlify.app',
      'https://propertyloop.ng',
      'https://www.propertyloop.ng',
      'https://admin.propertyloop.ng',
    ],
    credentials: true,
  },
  namespace: '/chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  // userId → Set of socketIds (one user can have multiple tabs)
  private userSockets = new Map<string, Set<string>>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => MessagesService))
    private readonly messagesService: MessagesService,
    private readonly prisma: PrismaService,
  ) {}

  // ─── Connection lifecycle ─────────────────────────────────────────────

  async handleConnection(client: Socket) {
    try {
      const token = this.extractToken(client);
      if (!token) {
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify<JwtPayload>(token, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
      });

      // Attach userId to the socket for later use
      client.data.userId = payload.sub;
      client.data.email = payload.email;
      client.data.role = payload.role;

      // Track this socket
      if (!this.userSockets.has(payload.sub)) {
        this.userSockets.set(payload.sub, new Set());
      }
      this.userSockets.get(payload.sub)!.add(client.id);

      // Join a personal room so we can emit to all of this user's tabs
      client.join(`user:${payload.sub}`);

      // Join rooms for all conversations this user participates in
      const participants =
        await this.prisma.conversationParticipant.findMany({
          where: { userId: payload.sub },
          select: { conversationId: true },
        });
      for (const p of participants) {
        client.join(`convo:${p.conversationId}`);
      }

      // Acknowledge connection with unread count
      const { unread } = await this.messagesService.getUnreadCount(
        payload.sub,
      );
      client.emit('connected', { userId: payload.sub, unread });
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data?.userId;
    if (userId && this.userSockets.has(userId)) {
      this.userSockets.get(userId)!.delete(client.id);
      if (this.userSockets.get(userId)!.size === 0) {
        this.userSockets.delete(userId);
      }
    }
  }

  // ─── Events ───────────────────────────────────────────────────────────

  /** Client sends a message */
  @SubscribeMessage('send_message')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId: string; text?: string; attachmentUrls?: string[] },
  ) {
    const userId = client.data?.userId;
    if (!userId || !body.conversationId || (!body.text?.trim() && !body.attachmentUrls?.length)) return;

    try {
      const message = await this.messagesService.sendMessage(
        userId,
        body.conversationId,
        { text: body.text?.trim() ?? '', attachmentUrls: body.attachmentUrls },
      );

      await this.broadcastNewMessage(body.conversationId, message);
    } catch (err) {
      client.emit('error', {
        event: 'send_message',
        message:
          err instanceof Error ? err.message : 'Failed to send message',
      });
    }
  }

  /** Client joins a conversation room (e.g. when opening a chat) */
  @SubscribeMessage('join_conversation')
  async handleJoinConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId: string },
  ) {
    const userId = client.data?.userId;
    if (!userId || !body.conversationId) return;

    // Verify participant
    const participant =
      await this.prisma.conversationParticipant.findUnique({
        where: {
          conversationId_userId: {
            conversationId: body.conversationId,
            userId,
          },
        },
      });
    if (!participant) return;

    client.join(`convo:${body.conversationId}`);

    // Mark as read
    await this.messagesService.markRead(userId, body.conversationId);
    client.emit('conversation_read', {
      conversationId: body.conversationId,
    });
  }

  /** Client is typing indicator */
  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId: string; isTyping: boolean },
  ) {
    const userId = client.data?.userId;
    if (!userId || !body.conversationId) return;

    // Broadcast to other participants in the conversation
    client.to(`convo:${body.conversationId}`).emit('user_typing', {
      conversationId: body.conversationId,
      userId,
      isTyping: body.isTyping,
    });
  }

  /** Client marks a conversation as read */
  @SubscribeMessage('mark_read')
  async handleMarkRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId: string },
  ) {
    const userId = client.data?.userId;
    if (!userId || !body.conversationId) return;

    await this.messagesService.markRead(userId, body.conversationId);
    client.emit('conversation_read', {
      conversationId: body.conversationId,
    });
  }

  // ─── Public broadcast API (called from MessagesService) ───────────────

  /**
   * Emit `new_message` to every participant of the conversation via their
   * personal `user:<id>` room. Personal rooms are always joined at socket
   * connection, so this works even for conversations that were created
   * AFTER the recipient's socket connected (the case that broke admin →
   * user delivery). Per-recipient `isYou` is computed so the receiving UI
   * increments unread correctly.
   */
  async broadcastNewMessage(
    conversationId: string,
    message: {
      id: string;
      conversationId: string;
      senderUserId: string;
      senderName: string;
      senderAvatar: string | null;
      text: string;
      attachmentUrls: string[];
      createdAt: string;
    },
    mask?: {
      senderIsAdmin: boolean;
      maskedName: string;
      maskedAvatar: string;
    },
  ) {
    const participants = await this.prisma.conversationParticipant.findMany({
      where: { conversationId },
      select: {
        userId: true,
        unreadCount: true,
        user: { select: { role: true } },
      },
    });

    for (const p of participants) {
      const isSender = p.userId === message.senderUserId;
      const recipientIsAdmin = p.user?.role === 'ADMIN';
      // Mask admin sender's identity for non-admin recipients.
      const applyMask = !!mask?.senderIsAdmin && !isSender && !recipientIsAdmin;

      this.server.to(`user:${p.userId}`).emit('new_message', {
        ...message,
        senderName: applyMask ? mask!.maskedName : message.senderName,
        senderAvatar: applyMask ? mask!.maskedAvatar : message.senderAvatar,
        isYou: isSender,
      });

      if (!isSender) {
        this.server.to(`user:${p.userId}`).emit('unread_update', {
          conversationId,
          unread: p.unreadCount,
        });
      }
    }
  }

  /**
   * Called after a new conversation is created. Joins every currently-
   * connected participant's sockets to the new `convo:<id>` room so
   * future typing/read events work, and emits `new_conversation` to each
   * participant's personal room so their UI can prepend the convo to the
   * list without a refresh.
   */
  async notifyConversationCreated(
    conversationId: string,
    participantIds: string[],
  ) {
    // Guard: only notify if the WebSocket server is initialized
    if (!this.server || !this.server.sockets) return;

    for (const userId of participantIds) {
      const socketIds = this.userSockets.get(userId);
      if (socketIds) {
        for (const sid of socketIds) {
          const sock = this.server.sockets.sockets?.get(sid);
          sock?.join(`convo:${conversationId}`);
        }
      }
      this.server
        .to(`user:${userId}`)
        .emit('new_conversation', { conversationId });
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  /** Check if a user is currently online */
  isUserOnline(userId: string): boolean {
    return this.userSockets.has(userId) && this.userSockets.get(userId)!.size > 0;
  }

  private extractToken(client: Socket): string | null {
    // Try auth header first, then query param
    const authHeader = client.handshake.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }
    return (client.handshake.query.token as string) || null;
  }
}
