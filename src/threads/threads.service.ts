import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateThreadDto } from './dto/create-thread.dto';
import { PostMessageDto } from './dto/post-message.dto';
import {
  ConversationKind,
  ConversationParticipantRole,
  Prisma,
} from '../../generated/prisma/client';
import { StaffAlertsService } from '../staff-alerts/staff-alerts.service';

/**
 * Internal staff conversations, built on the existing messaging tables.
 *
 * Three shapes, all Conversations with isInternal = true:
 *
 *   STAFF_GROUP   the all-staff channel
 *   STAFF_DIRECT  one-to-one
 *   STAFF_THREAD  discussion pinned to a listing, deal, lead or shoot
 *
 * The isInternal flag is not decoration. MessagesService.listConversations
 * returns every conversation a user participates in, so without it a staff
 * member who is also an agent would find internal threads sitting in their
 * customer inbox.
 */

const THREAD_INCLUDE = {
  participants: {
    include: {
      user: { select: { id: true, name: true, avatarUrl: true } },
    },
  },
  messages: {
    orderBy: { createdAt: 'asc' },
    include: {
      sender: { select: { id: true, name: true, avatarUrl: true } },
    },
  },
  // Conversation.listingId is a plain column with no foreign key — it
  // predates this work and some rows may point at listings that were since
  // deleted. Adding the relation would mean adding a constraint that could
  // fail against live data, so a listing-pinned thread resolves its title
  // through resolveSubjects() instead of an include.
  deal: { select: { id: true, company: true } },
  lead: { select: { id: true, name: true } },
  shoot: { select: { id: true, title: true } },
} satisfies Prisma.ConversationInclude;

export type ThreadSubjectKind =
  | 'LISTING'
  | 'DEAL'
  | 'LEAD'
  | 'SHOOT'
  | 'GENERAL';

@Injectable()
export class ThreadsService {
  constructor(
    private readonly prisma: PrismaService,
    // Optional so a unit test can build the service with Prisma alone.
    @Optional() private readonly alerts?: StaffAlertsService,
  ) {}

  /** Every internal conversation this user is in. */
  async list(userId: string, kind?: ConversationKind) {
    const threads = await this.prisma.conversation.findMany({
      where: {
        isInternal: true,
        ...(kind && { kind }),
        participants: { some: { userId } },
      },
      include: THREAD_INCLUDE,
      orderBy: { updatedAt: 'desc' },
    });
    return this.resolveListings(threads);
  }

  /**
   * Fills in the titles of listing-pinned threads.
   *
   * One extra query for the whole page rather than a join, for the reason
   * given on THREAD_INCLUDE.
   */
  private async resolveListings<T extends { listingId: string | null }>(
    threads: T[],
  ): Promise<(T & { listing: { id: string; title: string } | null })[]> {
    const ids = threads
      .map((t) => t.listingId)
      .filter((id): id is string => id !== null);

    if (ids.length === 0) {
      return threads.map((t) => ({ ...t, listing: null }));
    }

    const listings = await this.prisma.listing.findMany({
      where: { id: { in: ids } },
      select: { id: true, title: true },
    });
    const byId = new Map(listings.map((l) => [l.id, l]));

    return threads.map((t) => ({
      ...t,
      listing: t.listingId ? (byId.get(t.listingId) ?? null) : null,
    }));
  }

  /** Threads pinned to one record — what a Discuss button opens. */
  async listForSubject(subject: ThreadSubjectKind, id: string) {
    const where = this.subjectWhere(subject, id);
    if (!where) return [];
    const threads = await this.prisma.conversation.findMany({
      where: {
        isInternal: true,
        kind: ConversationKind.STAFF_THREAD,
        ...where,
      },
      include: THREAD_INCLUDE,
      orderBy: { updatedAt: 'desc' },
    });
    return this.resolveListings(threads);
  }

  private subjectWhere(
    subject: ThreadSubjectKind,
    id: string,
  ): Prisma.ConversationWhereInput | null {
    switch (subject) {
      case 'LISTING':
        return { listingId: id };
      case 'DEAL':
        return { dealId: id };
      case 'LEAD':
        return { leadId: id };
      case 'SHOOT':
        return { shootId: id };
      default:
        return null;
    }
  }

  async findOne(userId: string, id: string) {
    const thread = await this.prisma.conversation.findFirst({
      where: { id, isInternal: true, participants: { some: { userId } } },
      include: THREAD_INCLUDE,
    });
    if (!thread) {
      throw new NotFoundException('Thread not found');
    }
    const [withListing] = await this.resolveListings([thread]);
    return withListing;
  }

  async create(creatorUserId: string, dto: CreateThreadDto) {
    const participantIds = Array.from(
      new Set([creatorUserId, ...dto.participantUserIds]),
    );

    // Every participant must actually be staff. Adding a buyer to an internal
    // thread would put internal discussion in their customer inbox.
    const staffCount = await this.prisma.staffProfile.count({
      where: { userId: { in: participantIds }, active: true },
    });
    if (staffCount !== participantIds.length) {
      throw new BadRequestException(
        'Every participant must be an active staff member',
      );
    }

    const subjectWhere =
      dto.subject && dto.subjectId
        ? this.subjectWhere(dto.subject, dto.subjectId)
        : null;

    if (dto.subject && dto.subject !== 'GENERAL' && !subjectWhere) {
      throw new BadRequestException('Unknown subject kind');
    }

    const thread = await this.prisma.conversation.create({
      data: {
        isInternal: true,
        // Always a thread. A GENERAL one has no record behind it, but it is
        // still discussion with a title — filing it as STAFF_DIRECT put it in
        // the Messages inbox as a DM and took it out of Threads. Direct
        // messages have their own route, openDirect.
        kind: ConversationKind.STAFF_THREAD,
        title: dto.title,
        listingId: dto.subject === 'LISTING' ? dto.subjectId : null,
        dealId: dto.subject === 'DEAL' ? dto.subjectId : null,
        leadId: dto.subject === 'LEAD' ? dto.subjectId : null,
        shootId: dto.subject === 'SHOOT' ? dto.subjectId : null,
        participants: {
          create: participantIds.map((userId) => ({
            userId,
            role: ConversationParticipantRole.ADMIN,
          })),
        },
        ...(dto.firstMessage && {
          messages: {
            create: {
              senderUserId: creatorUserId,
              text: dto.firstMessage,
            },
          },
        }),
      },
      include: THREAD_INCLUDE,
    });
    this.alerts?.threadCreated(thread.id, creatorUserId);
    return thread;
  }

  /**
   * Find or open the one-to-one channel between two staff members.
   *
   * Idempotent: opening the same pair twice returns the existing channel
   * rather than creating a duplicate, whichever side opens it first.
   */
  async openDirect(userId: string, otherUserId: string) {
    if (userId === otherUserId) {
      throw new BadRequestException(
        'Cannot open a direct channel with yourself',
      );
    }

    const existing = await this.prisma.conversation.findFirst({
      where: {
        isInternal: true,
        kind: ConversationKind.STAFF_DIRECT,
        listingId: null,
        dealId: null,
        leadId: null,
        shootId: null,
        AND: [
          { participants: { some: { userId } } },
          { participants: { some: { userId: otherUserId } } },
        ],
      },
      include: THREAD_INCLUDE,
    });
    if (existing && existing.participants.length === 2) return existing;

    const other = await this.prisma.staffProfile.findUnique({
      where: { userId: otherUserId },
      select: { active: true },
    });
    if (!other?.active) {
      throw new BadRequestException(
        'That person is not an active staff member',
      );
    }

    return this.prisma.conversation.create({
      data: {
        isInternal: true,
        kind: ConversationKind.STAFF_DIRECT,
        participants: {
          create: [userId, otherUserId].map((id) => ({
            userId: id,
            role: ConversationParticipantRole.ADMIN,
          })),
        },
      },
      include: THREAD_INCLUDE,
    });
  }

  async postMessage(userId: string, threadId: string, dto: PostMessageDto) {
    const thread = await this.prisma.conversation.findFirst({
      where: { id: threadId, isInternal: true },
      select: { id: true, participants: { select: { userId: true } } },
    });
    if (!thread) throw new NotFoundException('Thread not found');
    if (!thread.participants.some((p) => p.userId === userId)) {
      throw new ForbiddenException('You are not in this thread');
    }

    const [message] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: {
          conversationId: threadId,
          senderUserId: userId,
          text: dto.text,
        },
        include: {
          sender: { select: { id: true, name: true, avatarUrl: true } },
        },
      }),
      // Sending is also reading, or your own message comes back unread.
      this.prisma.conversationParticipant.updateMany({
        where: { conversationId: threadId, userId },
        data: { lastReadAt: new Date() },
      }),
      this.prisma.conversationParticipant.updateMany({
        where: { conversationId: threadId, userId: { not: userId } },
        data: { unreadCount: { increment: 1 } },
      }),
      this.prisma.conversation.update({
        where: { id: threadId },
        data: { updatedAt: new Date() },
      }),
    ]);

    this.alerts?.messagePosted(threadId, userId, dto.text);
    return message;
  }

  async markRead(userId: string, threadId: string) {
    await this.prisma.conversationParticipant.updateMany({
      where: { conversationId: threadId, userId },
      data: { lastReadAt: new Date(), unreadCount: 0 },
    });
    return { read: true };
  }

  async setResolved(userId: string, threadId: string, resolved: boolean) {
    const thread = await this.prisma.conversation.findFirst({
      where: {
        id: threadId,
        isInternal: true,
        participants: { some: { userId } },
      },
      select: { id: true },
    });
    if (!thread) throw new NotFoundException('Thread not found');

    return this.prisma.conversation.update({
      where: { id: threadId },
      data: { resolvedAt: resolved ? new Date() : null },
      include: THREAD_INCLUDE,
    });
  }

  /** Total unread across every internal conversation. Drives the nav badge. */
  async unreadCount(userId: string) {
    const rows = await this.prisma.conversationParticipant.findMany({
      where: { userId, conversation: { isInternal: true } },
      select: { unreadCount: true },
    });
    return { unread: rows.reduce((n, r) => n + r.unreadCount, 0) };
  }

  /**
   * The all-staff channel, created on first use and topped up with anyone
   * who has joined since. A new colleague who cannot see what the team has
   * already agreed is worse than no channel.
   */
  async allStaffChannel(userId: string) {
    const activeStaff = await this.prisma.staffProfile.findMany({
      where: { active: true },
      select: { userId: true },
    });
    const staffUserIds = activeStaff.map((s) => s.userId);

    let channel = await this.prisma.conversation.findFirst({
      where: { isInternal: true, kind: ConversationKind.STAFF_GROUP },
      include: THREAD_INCLUDE,
    });

    if (!channel) {
      channel = await this.prisma.conversation.create({
        data: {
          isInternal: true,
          kind: ConversationKind.STAFF_GROUP,
          title: 'All staff',
          participants: {
            create: staffUserIds.map((id) => ({
              userId: id,
              role: ConversationParticipantRole.ADMIN,
            })),
          },
        },
        include: THREAD_INCLUDE,
      });
      return channel;
    }

    const present = new Set(channel.participants.map((p) => p.userId));
    const missing = staffUserIds.filter((id) => !present.has(id));
    if (missing.length > 0) {
      await this.prisma.conversationParticipant.createMany({
        data: missing.map((id) => ({
          conversationId: channel!.id,
          userId: id,
          role: ConversationParticipantRole.ADMIN,
        })),
        skipDuplicates: true,
      });
      channel = await this.prisma.conversation.findUnique({
        where: { id: channel.id },
        include: THREAD_INCLUDE,
      });
    }

    if (!channel!.participants.some((p) => p.userId === userId)) {
      throw new ForbiddenException('Staff access required');
    }
    return channel;
  }
}
