import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';
import {
  ConversationKind,
  ListingOwnership,
  StaffPermission,
} from '../../generated/prisma/client';

/**
 * Phone and browser notifications for the team portal.
 *
 * Standard Web Push: the portal's service worker subscribes each device, and
 * this service sends to those subscriptions when something happens that a
 * particular person needs to know about. It is deliberately targeted — the
 * person a thing was assigned to, the people in a conversation, or the holders
 * of the permission that lets them act on it — never "everyone, about
 * everything", which is how notifications get switched off.
 *
 * Every public method here is fire-and-forget. A notification that fails must
 * never fail the save, message or signup that caused it.
 */

export interface StaffAlert {
  title: string;
  body: string;
  /** Portal path the notification opens, e.g. /ops. */
  url: string;
  /** Notifications with the same tag replace each other on the device. */
  tag?: string;
}

type Audience =
  | { staffIds: (string | null | undefined)[] }
  | { userIds: (string | null | undefined)[] }
  | { permission: StaffPermission };

interface Exclude {
  staffId?: string | null;
  userId?: string | null;
}

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

const VAPID_ROW_ID = 'vapid';
const DEFAULT_SUBJECT = 'mailto:support.propertyloop@propertyloop.ng';
/** A notice about work that is a day old is noise, not news. */
const TTL_SECONDS = 24 * 60 * 60;

function clip(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function naira(amount: number): string {
  return `₦${Math.round(amount).toLocaleString('en-NG')}`;
}

@Injectable()
export class StaffAlertsService {
  private readonly logger = new Logger(StaffAlertsService.name);
  private keysPromise: Promise<VapidKeys> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /* ─── Keys ───────────────────────────────────────────────────────────── */

  /**
   * The VAPID key pair that identifies this server to the push services.
   *
   * WEB_PUSH_PUBLIC_KEY / WEB_PUSH_PRIVATE_KEY win when set. Otherwise a pair
   * is generated once and kept in the database, so every instance and every
   * deploy signs with the same key — a new key would silently orphan every
   * device already subscribed.
   */
  private keys(): Promise<VapidKeys> {
    this.keysPromise ??= this.loadKeys().catch((err: unknown) => {
      this.keysPromise = null;
      throw err;
    });
    return this.keysPromise;
  }

  private async loadKeys(): Promise<VapidKeys> {
    const publicKey = this.config.get<string>('WEB_PUSH_PUBLIC_KEY');
    const privateKey = this.config.get<string>('WEB_PUSH_PRIVATE_KEY');
    if (publicKey && privateKey) return { publicKey, privateKey };

    const stored = await this.prisma.webPushConfig.findUnique({
      where: { id: VAPID_ROW_ID },
    });
    if (stored) return stored;

    const generated = webpush.generateVAPIDKeys();
    try {
      return await this.prisma.webPushConfig.create({
        data: { id: VAPID_ROW_ID, ...generated },
      });
    } catch {
      // Another instance generated one first. Theirs is the key.
      const winner = await this.prisma.webPushConfig.findUnique({
        where: { id: VAPID_ROW_ID },
      });
      if (!winner) throw new Error('Could not create web push keys');
      return winner;
    }
  }

  async publicKey(): Promise<string> {
    return (await this.keys()).publicKey;
  }

  /* ─── Subscriptions ──────────────────────────────────────────────────── */

  /**
   * Remember a device for a user. Keyed on the endpoint: if somebody else
   * signs in on a shared phone, the device follows the person now using it.
   */
  async subscribe(
    userId: string,
    sub: { endpoint: string; p256dh: string; auth: string },
    userAgent?: string,
  ) {
    await this.prisma.webPushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: {
        userId,
        endpoint: sub.endpoint,
        p256dh: sub.p256dh,
        auth: sub.auth,
        userAgent: userAgent?.slice(0, 300) ?? null,
      },
      update: {
        userId,
        p256dh: sub.p256dh,
        auth: sub.auth,
        userAgent: userAgent?.slice(0, 300) ?? null,
        lastUsedAt: new Date(),
      },
    });
    return { subscribed: true };
  }

  async unsubscribe(userId: string, endpoint: string) {
    await this.prisma.webPushSubscription.deleteMany({
      where: { userId, endpoint },
    });
    return { subscribed: false };
  }

  /** Send a test to every device the user has, and say how many got it. */
  async sendTest(userId: string) {
    const delivered = await this.deliverToUsers([userId], {
      title: 'Notifications are working',
      body: 'This is how PropertyLoop Team will tell you when something needs you.',
      url: '/',
      tag: 'test',
    });
    return { delivered };
  }

  /* ─── Delivery ───────────────────────────────────────────────────────── */

  /** Fire and forget. */
  send(audience: Audience, alert: StaffAlert, exclude: Exclude = {}): void {
    void this.resolveUsers(audience, exclude)
      .then((userIds) => this.deliverToUsers(userIds, alert))
      .catch((err: unknown) =>
        this.logger.warn(
          `Staff alert "${alert.title}" failed: ${(err as Error).message}`,
        ),
      );
  }

  /** Active staff only: a deactivated colleague's phone stops hearing. */
  private async resolveUsers(
    audience: Audience,
    exclude: Exclude,
  ): Promise<string[]> {
    const where =
      'permission' in audience
        ? { active: true, permissions: { has: audience.permission } }
        : 'staffIds' in audience
          ? {
              active: true,
              id: { in: audience.staffIds.filter((x): x is string => !!x) },
            }
          : {
              active: true,
              userId: {
                in: audience.userIds.filter((x): x is string => !!x),
              },
            };

    const staff = await this.prisma.staffProfile.findMany({
      where,
      select: { id: true, userId: true },
    });
    return staff
      .filter((s) => s.id !== exclude.staffId && s.userId !== exclude.userId)
      .map((s) => s.userId);
  }

  private async deliverToUsers(
    userIds: string[],
    alert: StaffAlert,
  ): Promise<number> {
    if (userIds.length === 0) return 0;
    const subscriptions = await this.prisma.webPushSubscription.findMany({
      where: { userId: { in: userIds } },
    });
    if (subscriptions.length === 0) return 0;

    const keys = await this.keys();
    const subject =
      this.config.get<string>('WEB_PUSH_SUBJECT') ?? DEFAULT_SUBJECT;
    const payload = JSON.stringify({
      title: clip(alert.title, 80),
      body: clip(alert.body),
      url: alert.url,
      tag: alert.tag,
    });

    const results = await Promise.allSettled(
      subscriptions.map((s) =>
        webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          {
            vapidDetails: { subject, ...keys },
            TTL: TTL_SECONDS,
            urgency: 'high',
          },
        ),
      ),
    );

    // 404 and 410 mean the device unsubscribed or the app was removed.
    const dead: string[] = [];
    let delivered = 0;
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        delivered += 1;
        return;
      }
      const status = (r.reason as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) dead.push(subscriptions[i].id);
      else
        this.logger.warn(
          `Push to ${subscriptions[i].endpoint.slice(0, 60)}… failed: ${status ?? (r.reason as Error)?.message}`,
        );
    });
    if (dead.length > 0) {
      await this.prisma.webPushSubscription.deleteMany({
        where: { id: { in: dead } },
      });
    }
    return delivered;
  }

  /* ─── Events ─────────────────────────────────────────────────────────── */

  /** A message in a direct chat, the all-staff channel, or a thread. */
  messagePosted(conversationId: string, senderUserId: string, text: string) {
    void (async () => {
      const [conversation, sender] = await Promise.all([
        this.prisma.conversation.findUnique({
          where: { id: conversationId },
          select: {
            kind: true,
            title: true,
            participants: { select: { userId: true } },
          },
        }),
        this.prisma.user.findUnique({
          where: { id: senderUserId },
          select: { name: true },
        }),
      ]);
      if (!conversation) return;
      const who = sender?.name ?? 'A colleague';
      const title =
        conversation.kind === ConversationKind.STAFF_DIRECT
          ? who
          : conversation.kind === ConversationKind.STAFF_GROUP
            ? `${who} · All staff`
            : `${who} · ${conversation.title ?? 'Thread'}`;
      const url =
        conversation.kind === ConversationKind.STAFF_THREAD
          ? `/threads?open=${conversationId}`
          : `/messages?c=${conversationId}`;
      this.send(
        { userIds: conversation.participants.map((p) => p.userId) },
        { title, body: text, url, tag: `conversation-${conversationId}` },
        { userId: senderUserId },
      );
    })().catch((err: unknown) =>
      this.logger.warn(`messagePosted failed: ${(err as Error).message}`),
    );
  }

  threadCreated(conversationId: string, creatorUserId: string) {
    void (async () => {
      const [conversation, creator] = await Promise.all([
        this.prisma.conversation.findUnique({
          where: { id: conversationId },
          select: {
            title: true,
            participants: { select: { userId: true } },
          },
        }),
        this.prisma.user.findUnique({
          where: { id: creatorUserId },
          select: { name: true },
        }),
      ]);
      if (!conversation) return;
      this.send(
        { userIds: conversation.participants.map((p) => p.userId) },
        {
          title: `${creator?.name ?? 'A colleague'} added you to a thread`,
          body: conversation.title ?? 'New thread',
          url: `/threads?open=${conversationId}`,
          tag: `conversation-${conversationId}`,
        },
        { userId: creatorUserId },
      );
    })().catch((err: unknown) =>
      this.logger.warn(`threadCreated failed: ${(err as Error).message}`),
    );
  }

  opsTaskAssigned(
    subject: string,
    assigneeStaffId: string,
    actorStaffId?: string,
  ) {
    this.send(
      { staffIds: [assigneeStaffId] },
      { title: 'Task assigned to you', body: subject, url: '/ops' },
      { staffId: actorStaffId },
    );
  }

  leadAssigned(name: string, ownerStaffId: string, actorStaffId?: string) {
    this.send(
      { staffIds: [ownerStaffId] },
      {
        title: 'Lead assigned to you',
        body: `${name} — respond within 30 minutes`,
        url: '/leads',
      },
      { staffId: actorStaffId },
    );
  }

  dealAssigned(company: string, ownerStaffId: string, actorStaffId?: string) {
    this.send(
      { staffIds: [ownerStaffId] },
      { title: 'Deal assigned to you', body: company, url: '/deals' },
      { staffId: actorStaffId },
    );
  }

  shootAssigned(
    title: string,
    staffIds: (string | null | undefined)[],
    actorStaffId?: string,
    scheduledFor?: Date | null,
  ) {
    const when = scheduledFor
      ? ` · ${scheduledFor.toLocaleDateString('en-GB', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          timeZone: 'Africa/Lagos',
        })}`
      : '';
    this.send(
      { staffIds },
      { title: "You're on a shoot", body: `${title}${when}`, url: '/content' },
      { staffId: actorStaffId },
    );
  }

  partnerAssigned(
    partnerId: string,
    ownerStaffId: string,
    actorStaffId?: string,
  ) {
    void this.prisma.agentPartner
      .findUnique({
        where: { id: partnerId },
        select: { code: true, user: { select: { name: true } } },
      })
      .then((p) => {
        if (!p) return;
        this.send(
          { staffIds: [ownerStaffId] },
          {
            title: 'Agent partner assigned to you',
            body: `${p.user.name} (${p.code})`,
            url: '/partners',
          },
          { staffId: actorStaffId },
        );
      })
      .catch((err: unknown) =>
        this.logger.warn(`partnerAssigned failed: ${(err as Error).message}`),
      );
  }

  propertyForReview(title: string, creatorStaffId: string) {
    this.send(
      { permission: StaffPermission.PUBLISH_PROPERTY },
      { title: 'New property to review', body: title, url: '/properties' },
      { staffId: creatorStaffId },
    );
  }

  propertyPublished(
    title: string,
    sourcedByStaffId: string | null,
    actorStaffId?: string,
  ) {
    if (!sourcedByStaffId) return;
    this.send(
      { staffIds: [sourcedByStaffId] },
      {
        title: 'Your property is live',
        body: `${title} is now on the website and app`,
        url: '/properties',
      },
      { staffId: actorStaffId },
    );
  }

  targetSet(label: string, staffId: string, actorStaffId?: string) {
    this.send(
      { staffIds: [staffId] },
      { title: 'New target for you', body: label, url: '/targets' },
      { staffId: actorStaffId },
    );
  }

  /** Blockers are the part of a log a manager most needs to read. */
  blockerLogged(staffId: string, blockers: string) {
    void this.prisma.staffProfile
      .findUnique({
        where: { id: staffId },
        select: { reportsToId: true, user: { select: { name: true } } },
      })
      .then((s) => {
        if (!s?.reportsToId) return;
        this.send(
          { staffIds: [s.reportsToId] },
          {
            title: `${s.user.name} is blocked`,
            body: blockers,
            url: '/logs',
          },
          { staffId },
        );
      })
      .catch((err: unknown) =>
        this.logger.warn(`blockerLogged failed: ${(err as Error).message}`),
      );
  }

  kycSubmitted(fullName: string) {
    this.send(
      { permission: StaffPermission.REVIEW_KYC },
      { title: 'KYC to review', body: fullName, url: '/ops', tag: 'kyc' },
    );
  }

  withdrawalRequested(amountNaira: number) {
    this.send(
      { permission: StaffPermission.APPROVE_WITHDRAWAL },
      {
        title: 'Payout requested',
        body: `${naira(amountNaira)} is waiting for a manual transfer`,
        url: '/ops',
      },
    );
  }

  reportFiled(targetType: string, reason: string) {
    this.send(
      { permission: StaffPermission.HANDLE_OPS },
      {
        title: `New ${targetType.toLowerCase()} report — act within 24 hours`,
        body: reason,
        url: '/ops',
      },
    );
  }

  disputeOpened(jobTitle: string) {
    this.send(
      { permission: StaffPermission.RESOLVE_DISPUTE },
      {
        title: 'Escrow dispute opened',
        body: `${jobTitle} — the customer disputed the work`,
        url: '/ops',
      },
    );
  }

  /** An enquiry from the website or app. Only PropertyLoop's own stock is ours. */
  houseEnquiry(listingId: string, name: string) {
    void this.prisma.listing
      .findUnique({
        where: { id: listingId },
        select: { title: true, ownership: true },
      })
      .then((listing) => {
        if (listing?.ownership !== ListingOwnership.HOUSE) return;
        this.send(
          { permission: StaffPermission.QUALIFY_LEAD },
          {
            title: 'New enquiry',
            body: `${name} asked about ${listing.title}`,
            url: '/leads',
          },
        );
      })
      .catch((err: unknown) =>
        this.logger.warn(`houseEnquiry failed: ${(err as Error).message}`),
      );
  }

  partnerIntroducedBuyer(partnerId: string, listingId: string, buyer: string) {
    void Promise.all([
      this.prisma.agentPartner.findUnique({
        where: { id: partnerId },
        select: { code: true, user: { select: { name: true } } },
      }),
      this.prisma.listing.findUnique({
        where: { id: listingId },
        select: { title: true },
      }),
    ])
      .then(([partner, listing]) => {
        this.send(
          { permission: StaffPermission.QUALIFY_LEAD },
          {
            title: 'A partner brought a buyer',
            body: `${partner?.user.name ?? 'A partner'} (${partner?.code ?? '—'}) introduced ${buyer} for ${listing?.title ?? 'a listing'}`,
            url: '/leads',
          },
        );
      })
      .catch((err: unknown) =>
        this.logger.warn(
          `partnerIntroducedBuyer failed: ${(err as Error).message}`,
        ),
      );
  }

  /**
   * Somebody interested in PropertyLoop's own stock — a viewing, an offer or
   * a message from the website. Told to whoever sourced the property and to
   * everyone who qualifies leads, because a buyer waiting on us is the one
   * thing on this list that goes cold.
   */
  houseStockEnquiry(
    listingId: string,
    propertyTitle: string,
    kind: 'VIEWING' | 'OFFER' | 'MESSAGE',
    who: string,
    ownerStaffId: string | null,
  ) {
    const what =
      kind === 'VIEWING'
        ? 'wants to view'
        : kind === 'OFFER'
          ? 'made an offer on'
          : 'is asking about';
    const alert = {
      title: 'Enquiry on PropertyLoop stock',
      body: `${who} ${what} ${propertyTitle}`,
      url: '/leads',
      // The same device replaces an earlier notice about the same property
      // rather than stacking three.
      tag: `house-enquiry-${listingId}`,
    };
    if (ownerStaffId) this.send({ staffIds: [ownerStaffId] }, alert);
    this.send({ permission: StaffPermission.QUALIFY_LEAD }, alert, {
      staffId: ownerStaffId,
    });
  }

  partnerRegistered(fullName: string, code: string) {
    this.send(
      { permission: StaffPermission.MANAGE_PARTNERS },
      {
        title: 'New agent partner',
        body: `${fullName} (${code}) registered — contact within 48 hours`,
        url: '/partners',
      },
    );
  }
}
