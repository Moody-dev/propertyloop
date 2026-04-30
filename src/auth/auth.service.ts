import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { Role } from '../../generated/prisma/client';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import {
  ForgotPasswordDto,
  ResetPasswordDto,
  VerifyResetCodeDto,
} from './dto/forgot-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

interface SessionMeta {
  userAgent?: string;
  ipAddress?: string;
  deviceLabel?: string;
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}

@Injectable()
export class AuthService {
  private readonly accessTtl: string;
  private readonly refreshTtlDays: number;
  private readonly sessionTtlDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
  ) {
    this.accessTtl = this.configService.get<string>('JWT_ACCESS_TTL') || '15m';
    this.refreshTtlDays = parseInt(
      this.configService.get<string>('JWT_REFRESH_TTL_DAYS') || '30',
      10,
    );
    this.sessionTtlDays = parseInt(
      this.configService.get<string>('SESSION_TTL_DAYS') || '30',
      10,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SIGNUP
  // ─────────────────────────────────────────────────────────────────────────

  async signup(dto: SignupDto, meta: SessionMeta) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    // Role-specific validation
    if (dto.role === Role.AGENT && !dto.agent) {
      throw new BadRequestException('Agent profile data is required');
    }
    if (dto.role === Role.VENDOR && !dto.vendor) {
      throw new BadRequestException('Vendor profile data is required');
    }

    if (dto.role === Role.AGENT && dto.agent?.licenseNumber) {
      const dupe = await this.prisma.agentProfile.findUnique({
        where: { licenseNumber: dto.agent.licenseNumber },
      });
      if (dupe) {
        throw new ConflictException(
          'An agent with this license number is already registered',
        );
      }
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    // Create user + role-specific profile + default settings in one transaction
    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        passwordHash,
        name: dto.name,
        phone: dto.phone,
        role: dto.role,
        settings: { create: {} },
        ...(dto.role === Role.BUYER && {
          buyerProfile: {
            create: {
              preferredLocations: dto.buyer?.preferredLocations,
            },
          },
        }),
        ...(dto.role === Role.AGENT && {
          agentProfile: {
            create: {
              agencyName: dto.agent!.agencyName,
              licenseNumber: dto.agent!.licenseNumber,
              businessAddress: dto.agent!.businessAddress,
            },
          },
        }),
        ...(dto.role === Role.VENDOR && {
          vendorProfile: {
            create: {
              serviceCategory: dto.vendor!.serviceCategory,
              yearsExperience: dto.vendor!.yearsExperience,
              serviceArea: dto.vendor!.serviceArea,
            },
          },
        }),
      },
    });

    // Issue email verification token (fire-and-forget email)
    await this.sendEmailVerification(user.id, user.email, user.name);

    const tokens = await this.issueTokens(user.id, user.email, user.role, meta);

    // Reload with relations so the client receives the freshly-created
    // buyerProfile / agentProfile / vendorProfile right away — without
    // this, the dashboard pre-fill on first paint is empty until /auth/me
    // resolves on a later refresh.
    const fullUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      include: {
        buyerProfile: true,
        agentProfile: true,
        vendorProfile: true,
        settings: true,
      },
    });

    return {
      user: this.toFullUser(fullUser ?? user),
      ...tokens,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LOGIN
  // ─────────────────────────────────────────────────────────────────────────

  async login(dto: LoginDto, meta: SessionMeta) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      include: {
        buyerProfile: true,
        agentProfile: true,
        vendorProfile: true,
        settings: true,
      },
    });
    if (!user || user.deletedAt || !user.isActive) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const tokens = await this.issueTokens(user.id, user.email, user.role, meta);

    return {
      user: this.toFullUser(user),
      ...tokens,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // REFRESH TOKEN ROTATION
  // ─────────────────────────────────────────────────────────────────────────

  async refresh(rawRefreshToken: string, meta: SessionMeta) {
    const tokenHash = this.hashToken(rawRefreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Reuse detection — token already used means a thief used it. Revoke chain.
    if (stored.revokedAt || stored.replacedById) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.prisma.session.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException(
        'Refresh token reuse detected — all sessions revoked',
      );
    }

    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    if (!stored.user.isActive || stored.user.deletedAt) {
      throw new UnauthorizedException('Account is no longer active');
    }

    // Mint new pair, mark old as replaced
    const newRaw = this.generateOpaqueToken();
    const newHash = this.hashToken(newRaw);
    const newRefreshExpiresAt = new Date(
      Date.now() + this.refreshTtlDays * 86400_000,
    );

    const newStored = await this.prisma.refreshToken.create({
      data: {
        userId: stored.userId,
        tokenHash: newHash,
        expiresAt: newRefreshExpiresAt,
      },
    });

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { replacedById: newStored.id, revokedAt: new Date() },
    });

    const accessToken = await this.signAccessToken(
      stored.user.id,
      stored.user.email,
      stored.user.role,
    );

    // Touch session lastSeenAt if a session matches
    if (meta.userAgent) {
      await this.prisma.session.updateMany({
        where: {
          userId: stored.userId,
          revokedAt: null,
          userAgent: meta.userAgent,
        },
        data: { lastSeenAt: new Date() },
      });
    }

    const fullUser = await this.prisma.user.findUnique({
      where: { id: stored.user.id },
      include: {
        buyerProfile: true,
        agentProfile: true,
        vendorProfile: true,
        settings: true,
      },
    });

    return {
      user: this.toFullUser(fullUser ?? stored.user),
      accessToken,
      refreshToken: newRaw,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LOGOUT
  // ─────────────────────────────────────────────────────────────────────────

  async logout(userId: string, rawRefreshToken?: string) {
    if (rawRefreshToken) {
      const tokenHash = this.hashToken(rawRefreshToken);
      await this.prisma.refreshToken.updateMany({
        where: { tokenHash, userId },
        data: { revokedAt: new Date() },
      });
    } else {
      // No specific token → revoke all (e.g. "log out everywhere")
      await this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.prisma.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return { success: true };
  }

  async logoutAll(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FORGOT / RESET PASSWORD (6-digit code flow matches frontend)
  // ─────────────────────────────────────────────────────────────────────────

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    // Always return success — don't leak which emails are registered
    if (!user || user.deletedAt) {
      return { success: true };
    }

    // Invalidate any existing reset codes for this user
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const code = this.generateNumericCode(6);
    const codeHash = this.hashToken(`${user.id}:${code}`);
    const expiresAt = new Date(Date.now() + 15 * 60_000); // 15 min

    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: codeHash, expiresAt },
    });

    // Send email
    this.mailService
      .sendEmail({
        to: user.email,
        subject: 'PropertyLoop password reset code',
        text: `Your PropertyLoop password reset code is ${code}. It expires in 15 minutes.`,
        html: this.buildResetCodeEmail(user.name, code),
      })
      .catch((err) => console.error('Reset email failed:', err));

    return { success: true };
  }

  async verifyResetCode(dto: VerifyResetCodeDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (!user) {
      throw new BadRequestException('Invalid or expired code');
    }

    const codeHash = this.hashToken(`${user.id}:${dto.code}`);
    const token = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: codeHash },
    });
    if (
      !token ||
      token.userId !== user.id ||
      token.usedAt ||
      token.expiresAt < new Date()
    ) {
      throw new BadRequestException('Invalid or expired code');
    }

    return { success: true };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (!user) {
      throw new BadRequestException('Invalid or expired code');
    }

    const codeHash = this.hashToken(`${user.id}:${dto.code}`);
    const token = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: codeHash },
    });
    if (
      !token ||
      token.userId !== user.id ||
      token.usedAt ||
      token.expiresAt < new Date()
    ) {
      throw new BadRequestException('Invalid or expired code');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: token.id },
        data: { usedAt: new Date() },
      }),
      // Revoke all existing sessions/tokens — force re-login everywhere
      this.prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    return { success: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CHANGE PASSWORD (authenticated)
  // ─────────────────────────────────────────────────────────────────────────

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!valid) {
      throw new BadRequestException('Current password is incorrect');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    // Invalidate all other sessions and refresh tokens (security best practice)
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return { success: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // EMAIL VERIFICATION
  // ─────────────────────────────────────────────────────────────────────────

  async resendVerificationEmail(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, emailVerifiedAt: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.emailVerifiedAt) {
      throw new BadRequestException('Email already verified');
    }

    await this.prisma.emailVerificationToken.deleteMany({
      where: { userId, usedAt: null },
    });

    await this.sendEmailVerification(user.id, user.email, user.name);
    return { success: true };
  }

  /**
   * Public version of resendVerificationEmail — used on the verify-email
   * error page when a user's link has expired and they haven't (or can't)
   * log in. Always returns success so we don't leak which emails are
   * registered. Throttled at the controller layer.
   */
  async resendVerificationByEmail(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: {
        id: true,
        email: true,
        name: true,
        emailVerifiedAt: true,
        deletedAt: true,
      },
    });

    // Don't leak: success regardless of whether user exists / is verified.
    if (!user || user.deletedAt || user.emailVerifiedAt) {
      return { success: true };
    }

    await this.prisma.emailVerificationToken.deleteMany({
      where: { userId: user.id, usedAt: null },
    });

    await this.sendEmailVerification(user.id, user.email, user.name);
    return { success: true };
  }

  private async sendEmailVerification(
    userId: string,
    email: string,
    name: string,
  ) {
    const rawToken = this.generateOpaqueToken();
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60_000);

    await this.prisma.emailVerificationToken.create({
      data: { userId, tokenHash, expiresAt },
    });

    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';
    const link = `${frontendUrl}/verify-email?token=${rawToken}`;

    this.mailService
      .sendEmail({
        to: email,
        subject: 'Verify your PropertyLoop email',
        text: `Welcome to PropertyLoop! Verify your email by visiting: ${link}`,
        html: this.buildVerifyEmailHtml(name, link),
      })
      .catch((err) => console.error('Verify email failed:', err));
  }

  async verifyEmail(rawToken: string) {
    const tokenHash = this.hashToken(rawToken);
    const token = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
    });
    if (!token || token.usedAt || token.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired verification link');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: token.userId },
        data: { emailVerifiedAt: new Date() },
      }),
      this.prisma.emailVerificationToken.update({
        where: { id: token.id },
        data: { usedAt: new Date() },
      }),
    ]);

    return { success: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SESSIONS (Settings → active devices UI)
  // ─────────────────────────────────────────────────────────────────────────

  async listSessions(userId: string) {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
      select: {
        id: true,
        userAgent: true,
        ipAddress: true,
        deviceLabel: true,
        lastSeenAt: true,
        expiresAt: true,
        createdAt: true,
      },
    });
    return sessions;
  }

  async revokeSession(userId: string, sessionId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });
    if (!session || session.userId !== userId) {
      throw new NotFoundException('Session not found');
    }
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ME — current user with profile
  // ─────────────────────────────────────────────────────────────────────────

  async me(userId: string) {
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
    return this.toFullUser(user);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // INTERNAL HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  private async issueTokens(
    userId: string,
    email: string,
    role: Role,
    meta: SessionMeta,
  ): Promise<AuthTokens> {
    const accessToken = await this.signAccessToken(userId, email, role);

    const rawRefresh = this.generateOpaqueToken();
    const refreshHash = this.hashToken(rawRefresh);
    const refreshExpiresAt = new Date(
      Date.now() + this.refreshTtlDays * 86400_000,
    );

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: refreshHash,
        expiresAt: refreshExpiresAt,
      },
    });

    // Create a session row for the device-list UI
    const sessionRaw = this.generateOpaqueToken();
    const sessionHash = this.hashToken(sessionRaw);
    const sessionExpiresAt = new Date(
      Date.now() + this.sessionTtlDays * 86400_000,
    );
    const session = await this.prisma.session.create({
      data: {
        userId,
        tokenHash: sessionHash,
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
        deviceLabel: meta.deviceLabel || this.parseDeviceLabel(meta.userAgent),
        expiresAt: sessionExpiresAt,
      },
    });

    return {
      accessToken,
      refreshToken: rawRefresh,
      sessionId: session.id,
    };
  }

  private signAccessToken(userId: string, email: string, role: Role) {
    return this.jwtService.signAsync(
      { sub: userId, email, role },
      {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.accessTtl as any,
        issuer: 'propertyloop',
        audience: 'propertyloop-client',
      },
    );
  }

  private generateOpaqueToken(): string {
    return crypto.randomBytes(48).toString('base64url');
  }

  private generateNumericCode(length: number): string {
    let code = '';
    for (let i = 0; i < length; i++) {
      code += crypto.randomInt(0, 10).toString();
    }
    return code;
  }

  private hashToken(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  private parseDeviceLabel(ua?: string): string | undefined {
    if (!ua) return undefined;
    const browser = /Chrome/i.test(ua)
      ? 'Chrome'
      : /Firefox/i.test(ua)
        ? 'Firefox'
        : /Safari/i.test(ua)
          ? 'Safari'
          : /Edge/i.test(ua)
            ? 'Edge'
            : 'Browser';
    const os = /Windows/i.test(ua)
      ? 'Windows'
      : /Mac/i.test(ua)
        ? 'macOS'
        : /Android/i.test(ua)
          ? 'Android'
          : /iPhone|iPad/i.test(ua)
            ? 'iOS'
            : /Linux/i.test(ua)
              ? 'Linux'
              : 'Unknown';
    return `${browser} on ${os}`;
  }

  private toPublicUser(user: any) {
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
    };
  }

  private toFullUser(user: any) {
    return {
      ...this.toPublicUser(user),
      buyerProfile: user.buyerProfile,
      agentProfile: user.agentProfile,
      vendorProfile: user.vendorProfile,
      settings: user.settings,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // EMAIL TEMPLATES
  // ─────────────────────────────────────────────────────────────────────────

  private buildResetCodeEmail(name: string, code: string): string {
    return `
      <!DOCTYPE html>
      <html>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background:#f4f4f5; margin:0; padding:40px 16px;">
          <div style="max-width:560px; margin:0 auto; background:#ffffff; border:1px solid #e5e7eb; border-radius:8px; overflow:hidden;">
            <div style="background:#0f1f14; padding:28px 40px;">
              <div style="color:#ffffff; font-size:18px; font-weight:600;">PropertyLoop</div>
            </div>
            <div style="height:3px; background:#2f9e61;"></div>
            <div style="padding:40px;">
              <h1 style="font-size:20px; color:#111827; margin:0 0 16px;">Hi ${name},</h1>
              <p style="font-size:15px; color:#4b5563; line-height:1.7; margin:0 0 24px;">
                Use the code below to reset your PropertyLoop password. This code expires in <strong>15 minutes</strong>.
              </p>
              <div style="text-align:center; padding:24px; background:#f9fafb; border:1px solid #e5e7eb; border-radius:8px; margin:0 0 24px;">
                <div style="font-family: 'SF Mono', Menlo, Monaco, Consolas, monospace; font-size:32px; letter-spacing:8px; color:#0f1f14; font-weight:700;">
                  ${code}
                </div>
              </div>
              <p style="font-size:14px; color:#6b7280; line-height:1.6; margin:0;">
                If you didn't request this, you can safely ignore this email — your password won't change.
              </p>
            </div>
            <div style="background:#f9fafb; padding:20px 40px; text-align:center; border-top:1px solid #e5e7eb;">
              <div style="font-size:11px; color:#9ca3af;">&copy; 2026 PropertyLoop. All rights reserved.</div>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  private buildVerifyEmailHtml(name: string, link: string): string {
    return `
      <!DOCTYPE html>
      <html>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background:#f4f4f5; margin:0; padding:40px 16px;">
          <div style="max-width:560px; margin:0 auto; background:#ffffff; border:1px solid #e5e7eb; border-radius:8px; overflow:hidden;">
            <div style="background:#0f1f14; padding:28px 40px;">
              <div style="color:#ffffff; font-size:18px; font-weight:600;">PropertyLoop</div>
            </div>
            <div style="height:3px; background:#2f9e61;"></div>
            <div style="padding:40px;">
              <h1 style="font-size:20px; color:#111827; margin:0 0 16px;">Welcome to PropertyLoop, ${name}!</h1>
              <p style="font-size:15px; color:#4b5563; line-height:1.7; margin:0 0 24px;">
                Please confirm your email address to activate your account. This link expires in 24 hours.
              </p>
              <div style="text-align:center; margin:0 0 24px;">
                <a href="${link}" style="display:inline-block; background:#2f9e61; color:#ffffff; padding:14px 32px; border-radius:999px; text-decoration:none; font-weight:600; font-size:14px;">
                  Verify Email
                </a>
              </div>
              <p style="font-size:13px; color:#9ca3af; line-height:1.6; margin:0;">
                Or copy and paste this link into your browser:<br>
                <span style="color:#6b7280; word-break:break-all;">${link}</span>
              </p>
            </div>
            <div style="background:#f9fafb; padding:20px 40px; text-align:center; border-top:1px solid #e5e7eb;">
              <div style="font-size:11px; color:#9ca3af;">&copy; 2026 PropertyLoop. All rights reserved.</div>
            </div>
          </div>
        </body>
      </html>
    `;
  }
}
