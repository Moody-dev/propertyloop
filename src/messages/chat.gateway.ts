import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
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
    @MessageBody() body: { conversationId: string; text: string },
  ) {
    const userId = client.data?.userId;
    if (!userId || !body.conversationId || !body.text?.trim()) return;

    try {
      const message = await this.messagesService.sendMessage(
        userId,
        body.conversationId,
        { text: body.text.trim() },
      );

      // Broadcast to all participants in this conversation (including sender's other tabs)
      this.server
        .to(`convo:${body.conversationId}`)
        .emit('new_message', message);

      // Also emit unread update to other participants
      const participants =
        await this.prisma.conversationParticipant.findMany({
          where: {
            conversationId: body.conversationId,
            userId: { not: userId },
          },
          select: { userId: true, unreadCount: true },
        });
      for (const p of participants) {
        this.server.to(`user:${p.userId}`).emit('unread_update', {
          conversationId: body.conversationId,
          unread: p.unreadCount,
        });
      }
    } catch (err) {
      client.emit('error', {
        event: 'send_message',
        message: err?.message || 'Failed to send message',
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
