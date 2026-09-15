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

// Optional cookie Domain. Set COOKIE_DOMAIN=.propertyloop.ng once the API is
// served from a subdomain of the site (e.g. api.propertyloop.ng): the refresh
// cookie then becomes FIRST-party to the frontend, so browsers (Safari ITP,
// Chrome 3rd-party-cookie blocking) always send it on /auth/refresh — which is
// the permanent fix for the "logged out on reload" problem. Left unset, the
// cookie stays host-only (current cross-site behaviour) — so this is safe to
// ship before the DNS record exists.
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN?.trim() || undefined;

function refreshCookieOptions(req?: Request) {
  // Derive Secure/SameSite from the actual request protocol, NOT NODE_ENV.
  // The frontend (propertyloop.ng) and API live on different domains, so the
  // refresh cookie is cross-site and MUST be `SameSite=None; Secure` to be
  // sent on the /auth/refresh XHR — which only works over HTTPS. Gating this on
  // NODE_ENV silently broke refresh (→ logout on reload) whenever the env var
  // wasn't set to "production" on the host. Behind Railway/Render, the original
  // scheme arrives in `x-forwarded-proto`.
  const forwardedProto = (req?.headers['x-forwarded-proto'] as string | undefined)
    ?.split(',')[0]
    ?.trim()
    ?.toLowerCase();
  const isHttps = forwardedProto === 'https' || req?.secure === true;
  return {
    httpOnly: true,
    secure: isHttps, // localhost is http, so don't force secure in dev
    sameSite: (isHttps ? 'none' : 'lax') as 'none' | 'lax',
    path: '/api/auth',
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
    // Only include `domain` when configured — an undefined domain keeps the
    // cookie host-only, matching today's behaviour.
    ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}),
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
    return this.attachRefreshCookie(res, result, req);
  }

  // Generous per IP so a whole office can sign in at once, tight per account
  // so brute force is still stopped. The account limit is the one doing the
  // security work; the IP limit is only there to blunt a flood.
  @Throttle({
    default: { ttl: 60000, limit: 60 },
    account: { ttl: 60000, limit: 8 },
  })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto, this.extractMeta(req));
    return this.attachRefreshCookie(res, result, req);
  }

  // The team portal sends this through its own Netlify site, so the refresh
  // cookie is first-party there and Safari keeps it. That makes every staff
  // member's refresh arrive from a handful of Netlify addresses. A refresh is
  // useless without an unguessable token, so a generous per-IP limit costs no
  // security and stops a busy morning tripping the 30/min default.
  @Throttle({ default: { ttl: 60000, limit: 300 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Web sends the refresh token as an HttpOnly cookie; mobile sends it in the
    // body (no cookie jar in React Native).
    const rt = req.body?.refreshToken || req.cookies?.[REFRESH_COOKIE];
    if (!rt) {
      throw new UnauthorizedException('No refresh token');
    }
    const result = await this.authService.refresh(rt, this.extractMeta(req));
    return this.attachRefreshCookie(res, result, req);
  }

  // Proxied the same way as refresh, and it needs a signed-in session anyway.
  @Throttle({ default: { ttl: 60000, limit: 120 } })
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rt = req.cookies?.[REFRESH_COOKIE];
    // Match the attributes the cookie was set with (incl. domain) so the
    // browser actually drops the SameSite=None; Secure cookie.
    const { httpOnly, secure, sameSite, path, domain } =
      refreshCookieOptions(req);
    res.clearCookie(REFRESH_COOKIE, {
      httpOnly,
      secure,
      sameSite,
      path,
      ...(domain ? { domain } : {}),
    });
    return this.authService.logout(user.id, rt);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  async logoutAll(
    @CurrentUser() user: CurrentUserData,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.clearCookie(REFRESH_COOKIE, {
      path: '/api/auth',
      ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}),
    });
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
      platform: (
        (req.headers['x-client-platform'] as string)?.toLowerCase() ===
        'mobile'
          ? 'mobile'
          : 'web'
      ) as 'mobile' | 'web',
    };
  }

  /**
   * Move the refresh token from the response body into an HttpOnly cookie.
   * The web client never sees the refresh token in JS — XSS can't read it.
   *
   * Mobile clients (React Native) have no cookie jar, so when the request
   * announces itself via `X-Client-Platform: mobile` we ALSO return the refresh
   * token in the body for the app to persist in secure storage (Keychain /
   * Keystore). The cookie is still set but harmless for those clients.
   */
  private attachRefreshCookie(
    res: Response,
    result: { refreshToken?: string; [k: string]: unknown },
    req?: Request,
  ) {
    if (result.refreshToken) {
      res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions(req));
    }
    const isMobile =
      (req?.headers['x-client-platform'] as string)?.toLowerCase() === 'mobile';
    if (isMobile) {
      return result; // includes refreshToken for SecureStore
    }
    const { refreshToken: _omit, ...safe } = result;
    return safe;
  }
}
