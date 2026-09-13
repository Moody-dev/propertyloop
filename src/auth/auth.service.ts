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
import {
  Role,
  SubscriptionStatus,
  SubscriptionTier,
} from '../../generated/prisma/client';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import {
  ForgotPasswordDto,
  ResetPasswordDto,
  VerifyResetCodeDto,
} from './dto/forgot-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { allocateUniqueReferralCode } from '../common/referral';

interface SessionMeta {
  userAgent?: string;
  ipAddress?: string;
  deviceLabel?: string;
  /** From the X-Client-Platform header: which client this request came from. */
  platform?: 'mobile' | 'web';
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
  private readonly rotationGraceMs: number;
  // How long a just-consumed email-verification token is still treated as a
  // success if presented again. Covers a mail-security scanner beating the
  // real user to the link. Fixed rather than configurable: unlike refresh-
  // token rotation this isn't a security-sensitive tradeoff worth tuning per
  // deployment, just enough slack for a scanner-then-human double-open.
  private readonly verifyEmailReuseGraceMs = 15 * 60_000;

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
    // Grace window for refresh-token rotation. Single-use rotation races are
    // routine on the client (multiple tabs share one cookie, bootstrap fires a
    // refresh in parallel with the first authenticated request, requests get
    // retried). Within this window a just-rotated token presented again is
    // treated as a benign race and re-issued, instead of being flagged as
    // theft and revoking every session. Outside it, replay still trips full
    // reuse detection. Default 60s covers slow networks and cold starts.
    this.rotationGraceMs = parseInt(
      this.configService.get<string>('JWT_REFRESH_ROTATION_GRACE_MS') ||
        '60000',
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

    // License/RC number is optional. Only enforce uniqueness when the agent
    // actually provided one (blank stays NULL and never collides).
    const licenseNumber = dto.agent?.licenseNumber?.trim() || null;
    if (dto.role === Role.AGENT && licenseNumber) {
      const dupe = await this.prisma.agentProfile.findUnique({
        where: { licenseNumber },
      });
      if (dupe) {
        throw new ConflictException(
          'An agent with this license number is already registered',
        );
      }
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    // Resolve the referrer, if a referral code came with the signup. Unknown,
    // suspended, or deleted referrers are silently ignored — a bad code must
    // never block account creation.
    let referredById: string | undefined;
    if (dto.referralCode?.trim()) {
      const referrer = await this.prisma.user.findUnique({
        where: { referralCode: dto.referralCode.trim().toUpperCase() },
        select: { id: true, isActive: true, deletedAt: true },
      });
      if (referrer && referrer.isActive && !referrer.deletedAt) {
        referredById = referrer.id;
      }
    }

    // Every new user gets their own referral code from day one (all roles —
    // the referral program is not limited to agents/vendors).
    const referralCode = await allocateUniqueReferralCode(this.prisma);

    // Create user + role-specific profile + default settings in one transaction
    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        passwordHash,
        name: dto.name,
        phone: dto.phone,
        role: dto.role,
        referralCode,
        signupPlatform: meta.platform ?? 'web',
        ...(referredById && { referredById }),
        settings: { create: {} },
        ...(dto.role === Role.BUYER && {
          buyerProfile: {
            create: {
              preferredLocations: dto.buyer?.preferredLocations,
              lookingFor: dto.buyer?.lookingFor,
              budgetRange: dto.buyer?.budgetRange,
            },
          },
        }),
        ...(dto.role === Role.AGENT && {
          agentProfile: {
            create: {
              agencyName: dto.agent!.agencyName,
              licenseNumber, // normalized above; null when not provided
              businessAddress: dto.agent!.businessAddress,
              // New agents start on the FREE tier (capped at 3 active
              // listings). Waitlisted/early agents get upgraded to the
              // free-forever FOUNDING tier below; everyone else pays to lift
              // the cap. Status is ACTIVE so the free 3 listings are usable.
              subscriptionTier: SubscriptionTier.FREE,
              subscriptionStatus: SubscriptionStatus.ACTIVE,
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

    // NOTE: The free-forever FOUNDING tier is now frozen to accounts that
    // already hold it — new signups (waitlisted or not) start on FREE (3
    // listings) and pay to lift the cap. See agentProfile.create above.

    // They abandoned the signup form at some point and we captured the email
    // for follow-up — close that off now they've actually registered, so they
    // don't get chased. Best-effort: bookkeeping must never fail a signup.
    this.prisma.partialSignup
      .updateMany({
        where: { email: user.email, completedAt: null },
        data: { completedAt: new Date() },
      })
      .catch((err) => console.error('Partial-signup close-off failed:', err));

    // Let the referrer know their link converted (in-app, best-effort — a
    // notification failure must never break the signup).
    if (referredById) {
      this.prisma.notification
        .create({
          data: {
            userId: referredById,
            type: 'REFERRAL_SIGNUP',
            title: 'Your referral link worked 🎉',
            body: `${user.name} just joined PropertyLoop through your referral link.`,
            data: { referredUserId: user.id },
          },
        })
        .catch((err) =>
          console.error('Referral notification failed:', err),
        );
    }

    // Issue email verification token (fire-and-forget email)
    await this.sendEmailVerification(
      user.id,
      user.email,
      user.name,
      user.signupPlatform,
    );

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
        // Team portal. Present only for PropertyLoop staff — this is what
        // the portal gates on, not Role, so it has to arrive with the
        // session rather than needing a second round trip on first paint.
        staffProfile: true,
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
        // Team portal. Present only for PropertyLoop staff — this is what
        // the portal gates on, not Role, so it has to arrive with the
        // session rather than needing a second round trip on first paint.
        staffProfile: true,
      },
    });
    // Permanently closed accounts stay blocked, full stop. A merely-inactive
    // account is either an admin suspension (deactivatedAt null — stays
    // blocked; only an admin can lift it) or a self-deactivation
    // (deactivatedAt set — the correct password below reactivates it). Same
    // generic message either way so we don't leak account state.
    if (!user || user.deletedAt || (!user.isActive && !user.deactivatedAt)) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    let reactivated = false;
    if (user.deactivatedAt) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { isActive: true, deactivatedAt: null },
      });
      user.isActive = true;
      user.deactivatedAt = null;
      reactivated = true;
    }

    const tokens = await this.issueTokens(user.id, user.email, user.role, meta);

    return {
      user: this.toFullUser(user),
      ...(reactivated && { reactivated: true }),
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

    // Was this token rotated to a successor? (single-use rotation set both
    // replacedById AND revokedAt). Only a rotated token is eligible for the
    // benign-race grace window.
    const wasRotated = !!stored.replacedById;

    if (wasRotated) {
      // A just-rotated token presented again within the grace window is almost
      // always a benign client race (multiple tabs, bootstrap double-refresh,
      // a retried request) — not theft. Re-issue without touching the rest of
      // the session. Only a replay *after* the grace window is treated as a
      // stolen token, which revokes the entire token + session chain.
      const revokedAgoMs = stored.revokedAt
        ? Date.now() - stored.revokedAt.getTime()
        : Infinity;
      if (revokedAgoMs > this.rotationGraceMs) {
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
      // else: within grace → fall through and mint a fresh pair below.
    } else if (stored.revokedAt) {
      // Revoked but never rotated = a deliberate kill: logout, "log out
      // everywhere", password reset, or admin action. Never re-issue it.
      throw new UnauthorizedException('Refresh token has been revoked');
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

    // Normal rotation: mark the presented token as replaced. In the within-grace
    // race path the token is already rotated, so leave its existing chain
    // pointer intact — we just issued an extra fresh token for the racing
    // client without disturbing the original successor.
    if (!wasRotated) {
      await this.prisma.refreshToken.update({
        where: { id: stored.id },
        data: { replacedById: newStored.id, revokedAt: new Date() },
      });
    }

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
        // Team portal. Present only for PropertyLoop staff — this is what
        // the portal gates on, not Role, so it has to arrive with the
        // session rather than needing a second round trip on first paint.
        staffProfile: true,
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
      select: {
        id: true,
        email: true,
        name: true,
        emailVerifiedAt: true,
        signupPlatform: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.emailVerifiedAt) {
      throw new BadRequestException('Email already verified');
    }

    await this.prisma.emailVerificationToken.deleteMany({
      where: { userId, usedAt: null },
    });

    await this.sendEmailVerification(
      user.id,
      user.email,
      user.name,
      user.signupPlatform,
    );
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
        signupPlatform: true,
      },
    });

    // Don't leak: success regardless of whether user exists / is verified.
    if (!user || user.deletedAt || user.emailVerifiedAt) {
      return { success: true };
    }

    await this.prisma.emailVerificationToken.deleteMany({
      where: { userId: user.id, usedAt: null },
    });

    await this.sendEmailVerification(
      user.id,
      user.email,
      user.name,
      user.signupPlatform,
    );
    return { success: true };
  }

  private async sendEmailVerification(
    userId: string,
    email: string,
    name: string,
    signupPlatform?: string | null,
  ) {
    const rawToken = this.generateOpaqueToken();
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60_000);

    await this.prisma.emailVerificationToken.create({
      data: { userId, tokenHash, expiresAt },
    });

    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';
    // The link always opens on the website (it's what's clickable from an
    // email client), but a mobile signup should land back in the app once
    // verified rather than the website's login page. Tag it so
    // VerifyEmail.tsx knows which way to send the user afterwards.
    const link =
      signupPlatform === 'mobile'
        ? `${frontendUrl}/verify-email?token=${rawToken}&platform=mobile`
        : `${frontendUrl}/verify-email?token=${rawToken}`;

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
    if (!token || token.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired verification link');
    }

    if (token.usedAt) {
      // Some corporate mail-security gateways and link scanners open a
      // verification link server-side to prescan it before the person ever
      // taps it themselves, silently burning a single-use token before the
      // real click arrives. Rather than lock the actual user out with a
      // false "invalid link" for an action that already succeeded, treat a
      // reuse within a short grace window as a success (mirrors the
      // refresh-token reuse grace window above). A reuse well outside that
      // window is treated as genuinely stale, same as before.
      const usedAgoMs = Date.now() - token.usedAt.getTime();
      if (usedAgoMs <= this.verifyEmailReuseGraceMs) {
        return { success: true };
      }
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
        // Team portal. Present only for PropertyLoop staff — this is what
        // the portal gates on, not Role, so it has to arrive with the
        // session rather than needing a second round trip on first paint.
        staffProfile: true,
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
      referralCode: user.referralCode,
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
      // Null for everyone who is not staff. The portal checks this and the
      // permissions on it; a deactivated profile is still returned so the
      // client can say why access stopped rather than showing a blank gate.
      staffProfile: user.staffProfile
        ? {
            id: user.staffProfile.id,
            letter: user.staffProfile.letter,
            staffRole: user.staffProfile.staffRole,
            chapter: user.staffProfile.chapter,
            secondaryChapter: user.staffProfile.secondaryChapter,
            permissions: user.staffProfile.permissions,
            active: user.staffProfile.active,
          }
        : null,
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
