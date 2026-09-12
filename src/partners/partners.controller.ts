import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PartnersService } from './partners.service';
import { RegisterPartnerDto } from './dto/register-partner.dto';
import { IntroduceBuyerDto } from './dto/introduce-buyer.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  CurrentUserData,
} from '../auth/decorators/current-user.decorator';

@Controller('partners')
export class PartnersController {
  constructor(private readonly service: PartnersService) {}

  /**
   * Public registration. Deliberately unauthenticated — this is the link
   * realtors are sent, and requiring an account first defeats the point.
   *
   * Rate limited well below the global 30/min: a recruitment link gets
   * posted in WhatsApp groups, which is exactly where a script would find
   * it, and each call creates a User row.
   */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  register(@Body() dto: RegisterPartnerDto) {
    return this.service.register(dto);
  }

  /** Used by the form to confirm a referral code as it is typed. */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('referral-check')
  checkReferral(@Query('code') code: string) {
    return this.service.checkReferral(code);
  }

  /* ─── Partner's own view ─────────────────────────────────────────── */

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: CurrentUserData) {
    return this.service.me(user.id);
  }

  /** House inventory the partner may sell. */
  @UseGuards(JwtAuthGuard)
  @Get('inventory')
  inventory(
    @CurrentUser() user: CurrentUserData,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(24), ParseIntPipe) limit: number,
    @Query('state') state?: string,
  ) {
    return this.service.houseInventory(user.id, {
      page,
      limit: Math.min(limit, 60),
      state,
    });
  }

  /** Introduce a buyer to a house listing — the commission attribution. */
  @UseGuards(JwtAuthGuard)
  @Post('inventory/:listingId/introduce')
  introduce(
    @CurrentUser() user: CurrentUserData,
    @Param('listingId') listingId: string,
    @Body() dto: IntroduceBuyerDto,
  ) {
    return this.service.introduceBuyer(user.id, listingId, dto);
  }
}
