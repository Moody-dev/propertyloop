import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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
      createdAt: user.createdAt,
      buyerProfile: user.buyerProfile,
      agentProfile: user.agentProfile,
      vendorProfile: user.vendorProfile,
      settings: user.settings,
    };
  }
}
