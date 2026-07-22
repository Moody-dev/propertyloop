import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { assertNotObjectionable } from '../common/content-filter';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { UpdateBuyerProfileDto } from './dto/update-buyer-profile.dto';
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

  async softDeleteAccount(userId: string) {
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { deletedAt: new Date(), isActive: false },
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
