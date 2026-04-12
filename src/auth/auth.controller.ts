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
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import {
  ForgotPasswordDto,
  ResetPasswordDto,
  VerifyResetCodeDto,
} from './dto/forgot-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser, CurrentUserData } from './decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  signup(@Body() dto: SignupDto, @Req() req: Request) {
    return this.authService.signup(dto, this.extractMeta(req));
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, this.extractMeta(req));
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.authService.refresh(dto.refreshToken, this.extractMeta(req));
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@CurrentUser() user: CurrentUserData, @Body() body: { refreshToken?: string }) {
    return this.authService.logout(user.id, body?.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  logoutAll(@CurrentUser() user: CurrentUserData) {
    return this.authService.logoutAll(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: CurrentUserData) {
    return this.authService.me(user.id);
  }

  // ─── Password reset ───────────────────────────────────────────────────────

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('verify-reset-code')
  @HttpCode(HttpStatus.OK)
  verifyResetCode(@Body() dto: VerifyResetCodeDto) {
    return this.authService.verifyResetCode(dto);
  }

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
}
