import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  CurrentUserData,
} from '../auth/decorators/current-user.decorator';
import { StaffPermissionsGuard } from '../staff/guards/staff-permissions.guard';
import { RequireStaff } from '../staff/decorators/require-staff.decorator';
import { StaffThrottle } from '../staff/staff-throttle';
import { StaffAlertsService } from './staff-alerts.service';
import {
  PushSubscriptionDto,
  RemovePushSubscriptionDto,
} from './dto/push-subscription.dto';

/**
 * Registering a phone or browser for team portal notifications.
 *
 * Staff only: a customer account has nothing here to be notified about.
 */
@UseGuards(JwtAuthGuard, StaffPermissionsGuard)
@RequireStaff()
@StaffThrottle()
@Controller('staff/push')
export class StaffPushController {
  constructor(private readonly alerts: StaffAlertsService) {}

  @Get('public-key')
  async publicKey() {
    return { publicKey: await this.alerts.publicKey() };
  }

  @Post('subscriptions')
  @HttpCode(HttpStatus.OK)
  subscribe(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: PushSubscriptionDto,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.alerts.subscribe(user.id, dto, userAgent);
  }

  /** POST rather than DELETE: some proxies drop a DELETE's body. */
  @Post('subscriptions/remove')
  @HttpCode(HttpStatus.OK)
  unsubscribe(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: RemovePushSubscriptionDto,
  ) {
    return this.alerts.unsubscribe(user.id, dto.endpoint);
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  test(@CurrentUser() user: CurrentUserData) {
    return this.alerts.sendTest(user.id);
  }
}
