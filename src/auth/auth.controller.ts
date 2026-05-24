import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import {
  ForgotPasswordDto,
  ResetPasswordDto,
  VerifyResetCodeDto,
} from './dto/forgot-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import {
  CurrentUser,
  CurrentUserData,
} from './decorators/current-user.decorator';
import { Throttle } from '@nestjs/throttler';

/**
 * Refresh tokens live in an HttpOnly Secure cookie (XSS-safe). The access
 * token still travels in the JSON body so the frontend can attach it as a
 * Bearer header on every request without paying a cookie round-trip on
 * every API call.
 */
const REFRESH_COOKIE = 'pl_refresh_token';
const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function refreshCookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd, // localhost is http, so don't force secure in dev
    sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
    path: '/api/auth',
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
  };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('signup')
  async signup(
    @Body() dto: SignupDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.signup(dto, this.extractMeta(req));
    return this.attachRefreshCookie(res, result);
  }

  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto, this.extractMeta(req));
    return this.attachRefreshCookie(res, result);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rt = req.cookies?.[REFRESH_COOKIE];
    if (!rt) {
      throw new UnauthorizedException('No refresh token');
    }
    const result = await this.authService.refresh(rt, this.extractMeta(req));
    return this.attachRefreshCookie(res, result);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rt = req.cookies?.[REFRESH_COOKIE];
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    return this.authService.logout(user.id, rt);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  async logoutAll(
    @CurrentUser() user: CurrentUserData,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    return this.authService.logoutAll(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: CurrentUserData) {
    return this.authService.me(user.id);
  }

  // ─── Password reset ───────────────────────────────────────────────────────

  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('verify-reset-code')
  @HttpCode(HttpStatus.OK)
  verifyResetCode(@Body() dto: VerifyResetCodeDto) {
    return this.authService.verifyResetCode(dto);
  }

  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  changePassword(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(user.id, dto);
  }

  // ─── Email verification ───────────────────────────────────────────────────

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  verifyEmail(@Body() body: { token: string }) {
    return this.authService.verifyEmail(body.token);
  }

  @UseGuards(JwtAuthGuard)
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  resendVerification(@CurrentUser() user: CurrentUserData) {
    return this.authService.resendVerificationEmail(user.id);
  }

  // Public resend — used when a verification link expires and the user
  // is not (or cannot be) signed in. Always returns success to avoid
  // leaking which emails are registered. Tightly rate-limited.
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @Post('resend-verification-public')
  @HttpCode(HttpStatus.OK)
  resendVerificationPublic(@Body() body: { email: string }) {
    return this.authService.resendVerificationByEmail(body?.email ?? '');
  }

  // ─── Sessions / active devices ────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Get('sessions')
  listSessions(@CurrentUser() user: CurrentUserData) {
    return this.authService.listSessions(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('sessions/:id')
  revokeSession(
    @CurrentUser() user: CurrentUserData,
    @Param('id') sessionId: string,
  ) {
    return this.authService.revokeSession(user.id, sessionId);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private extractMeta(req: Request) {
    return {
      userAgent: req.headers['user-agent'],
      ipAddress:
        (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
        req.socket?.remoteAddress,
    };
  }

  /**
   * Move the refresh token from the response body into an HttpOnly cookie.
   * The client never sees the refresh token in JS — XSS can't read it.
   */
  private attachRefreshCookie(
    res: Response,
    result: { refreshToken?: string; [k: string]: unknown },
  ) {
    if (result.refreshToken) {
      res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions());
    }
    const { refreshToken: _omit, ...safe } = result;
    return safe;
  }
}
