import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AdsService } from './ads.service';
import { CreateAdDto } from './dto/create-ad.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  CurrentUserData,
} from '../auth/decorators/current-user.decorator';
import { AdPlacement } from '../../generated/prisma/client';

@Controller('ads')
export class AdsController {
  constructor(private readonly adsService: AdsService) {}

  // ─── Public ──────────────────────────────────────────────────────────────

  @Get('serve')
  serve(@Query('placement') placement?: string) {
    if (!placement || !(placement in AdPlacement)) {
      throw new BadRequestException('Unknown placement');
    }
    return this.adsService.serve(placement as AdPlacement);
  }

  @Get('pricing')
  pricing() {
    return this.adsService.pricing();
  }

  // Tracking beacons fire on every slot render — exempt them from the global
  // 30 req/min throttle so busy browsing doesn't 429 legitimate app traffic.
  @SkipThrottle()
  @Post(':id/impression')
  @HttpCode(HttpStatus.OK)
  impression(@Param('id') id: string) {
    return this.adsService.trackImpression(id);
  }

  @SkipThrottle()
  @Post(':id/click')
  @HttpCode(HttpStatus.OK)
  click(@Param('id') id: string) {
    return this.adsService.trackClick(id);
  }

  // ─── Brand (authenticated advertiser) ────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@CurrentUser() user: CurrentUserData, @Body() dto: CreateAdDto) {
    return this.adsService.create(user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('mine')
  listMine(@CurrentUser() user: CurrentUserData) {
    return this.adsService.listMine(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/pay')
  @HttpCode(HttpStatus.OK)
  pay(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.adsService.initPayment(user.id, id, user.email);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/verify')
  verify(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.adsService.verifyPayment(user.id, id);
  }
}
