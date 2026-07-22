import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { assertNotObjectionable } from '../common/content-filter';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { UpdateBuyerProfileDto } from './dto/update-buyer-profile.dto';
import { ListingStatus, Role } from '../../generated/prisma/client';
import {
  allocateUniqueReferralCode,
  buildReferralLink,
} from '../common/referral';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * The signed-in user's referral panel: their personalized link, code, and
   * everyone who signed up through it. Accounts that predate the referral
   * program have no code yet — mint one on first visit so the program is
   * retroactively open to every user, regardless of role.
   */
  async getMyReferrals(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, referralCode: true },
    });
    if (!user) throw new NotFoundException('User not found');

    let code = user.referralCode;
    if (!code) {
      code = await allocateUniqueReferralCode(this.prisma);
      await this.prisma.user.update({
        where: { id: userId },
        data: { referralCode: code },
      });
    }

    const referrals = await this.prisma.user.findMany({
      where: { referredById: userId, deletedAt: null },
      select: {
        id: true,
        name: true,
        role: true,
        avatarUrl: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';

    return {
      referralCode: code,
      referralLink: buildReferralLink(frontendUrl, code),
      totalReferrals: referrals.length,
      referrals,
    };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        buyerProfile: true,
        agentProfile: true,
        vendorProfile: true,
        settings: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return this.serialize(user);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    assertNotObjectionable(dto.bio, 'Bio');

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.location !== undefined && { location: dto.location }),
        ...(dto.bio !== undefined && { bio: dto.bio }),
        ...(dto.avatarUrl !== undefined && { avatarUrl: dto.avatarUrl }),
      },
      include: {
        buyerProfile: true,
        agentProfile: true,
        vendorProfile: true,
        settings: true,
      },
    });
    return this.serialize(updated);
  }

  async updateBuyerProfile(userId: string, dto: UpdateBuyerProfileDto) {
    const data = {
      ...(dto.lookingFor !== undefined && { lookingFor: dto.lookingFor }),
      ...(dto.preferredLocations !== undefined && {
        preferredLocations: dto.preferredLocations,
      }),
      ...(dto.budgetRange !== undefined && { budgetRange: dto.budgetRange }),
      ...(dto.budgetMin !== undefined && { budgetMin: dto.budgetMin }),
      ...(dto.budgetMax !== undefined && { budgetMax: dto.budgetMax }),
    };
    await this.prisma.buyerProfile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return this.getProfile(userId);
  }

  async getSettings(userId: string) {
    let settings = await this.prisma.userSettings.findUnique({
      where: { userId },
    });
    if (!settings) {
      settings = await this.prisma.userSettings.create({
        data: { userId },
      });
    }
    return settings;
  }

  async updateSettings(userId: string, dto: UpdateSettingsDto) {
    const settings = await this.prisma.userSettings.upsert({
      where: { userId },
      update: { ...dto },
      create: { userId, ...dto },
    });
    return settings;
  }

  /**
   * Permanently deletes the account. Per App Store guideline 5.1.1(v), this
   * must remove — not just deactivate — the account, and any user-generated
   * content shared with others (photos, posts, reviews) along with it.
   *
   * The User row itself is kept (flagged deletedAt/isActive so login is
   * permanently blocked with no reactivation path, unlike deactivateAccount)
   * because it's the foreign-key anchor for records other users depend on —
   * a conversation partner's messages, an order history, a completed job.
   * Deleting it outright would either cascade-destroy other people's data or
   * violate a FK constraint. Instead: strip every personally-identifying and
   * shared-content field, and remove/redact content visible to other users.
   *
   * Intentionally retained (and disclosed in the Privacy Policy):
   * - KYC submissions — identity-verification audit trail.
   * - Orders, payments, vendor earnings, withdrawals — financial/accounting
   *   records Nigerian law and our own dispute process require us to keep.
   * - Job dispute messages — evidence for an escrow dispute that may still
   *   be open or referenced later.
   * - Reports filed by or about this account — moderation history.
   * Not covered by this pass: purging the underlying image/video files from
   * cloud storage (only the DB references are cleared, so nothing in the app
   * points to them anymore) — a storage-level sweep is a reasonable follow-up
   * but out of scope here.
   */
  async softDeleteAccount(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const ops: any[] = [
      // Anonymize the account. Email is rewritten (not just nulled — it's
      // @unique) so the person can sign up again later if they choose, and
      // so nothing personally-identifying survives on the row other users'
      // records still point to.
      this.prisma.user.update({
        where: { id: userId },
        data: {
          deletedAt: new Date(),
          isActive: false,
          name: 'Deleted user',
          bio: null,
          avatarUrl: null,
          phone: null,
          location: null,
          email: `deleted-${userId}@deleted.propertyloop.ng`,
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),

      // Chat messages this user sent — redact the body, keep the row so the
      // other participant's conversation isn't left with a broken gap.
      this.prisma.message.updateMany({
        where: { senderUserId: userId },
        data: { text: '[message removed]', attachmentUrls: [] },
      }),

      // Reviews they wrote (agent reviews only — VendorReview has no
      // reviewer FK to key off, a pre-existing schema gap).
      this.prisma.agentReview.updateMany({
        where: { reviewerUserId: userId },
        data: { comment: '[review removed]', reviewerName: 'Deleted user' },
      }),

      // Feed comments — redact body only. Deleting the row would cascade
      // (onDelete: Cascade on the self-relation) and destroy OTHER users'
      // replies nested under it.
      this.prisma.feedComment.updateMany({
        where: { authorId: userId },
        data: { body: '[comment removed]' },
      }),
    ];

    // Feed posts — delete outright. Comments/likes on the user's own post
    // cascade with it, which matches "delete my post" as users expect.
    ops.push(this.prisma.feedPost.deleteMany({ where: { authorId: userId } }));

    if (user.role === Role.AGENT) {
      // Take active/pending/paused listings off the market. Sold/rented
      // listings are left as historical record (already anonymized via the
      // User join above) rather than archived, since they're not live
      // inventory to begin with.
      ops.push(
        this.prisma.listing.updateMany({
          where: {
            agentId: userId,
            status: {
              in: [
                ListingStatus.ACTIVE,
                ListingStatus.PENDING_REVIEW,
                ListingStatus.PAUSED,
              ],
            },
          },
          data: { status: ListingStatus.ARCHIVED },
        }),
      );
    }

    if (user.role === Role.VENDOR) {
      ops.push(
        this.prisma.vendorProfile.updateMany({
          where: { userId },
          data: {
            bannerImage: null,
            portfolioImages: [],
            website: null,
            availableForHire: false,
          },
        }),
      );
    }

    await this.prisma.$transaction(ops);
    return { success: true };
  }

  /**
   * Reversible pause: logs the user out everywhere immediately (isActive
   * false, same as suspension, so the JWT strategy rejects existing tokens
   * right away). Unlike delete, deactivatedAt (not deletedAt) marks this as
   * self-service, so AuthService.login() knows a correct password should
   * reactivate the account rather than staying permanently blocked.
   */
  async deactivateAccount(userId: string) {
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { isActive: false, deactivatedAt: new Date() },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return { success: true };
  }

  private serialize(user: any) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      phone: user.phone,
      location: user.location,
      bio: user.bio,
      avatarUrl: user.avatarUrl,
      emailVerifiedAt: user.emailVerifiedAt,
      referralCode: user.referralCode,
      createdAt: user.createdAt,
      buyerProfile: user.buyerProfile,
      agentProfile: user.agentProfile,
      vendorProfile: user.vendorProfile,
      settings: user.settings,
    };
  }
}
