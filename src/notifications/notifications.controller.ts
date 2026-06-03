import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  CurrentUserData,
} from '../auth/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @CurrentUser() user: CurrentUserData,
    @Query() query: ListNotificationsDto,
  ) {
    return this.notifications.list(user.id, query);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: CurrentUserData) {
    return this.notifications.unreadCount(user.id);
  }

  @Post('read-all')
  markAllRead(@CurrentUser() user: CurrentUserData) {
    return this.notifications.markAllRead(user.id);
  }

  @Post(':id/read')
  markRead(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.notifications.markRead(user.id, id);
  }

  @Post('push-tokens')
  registerToken(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: RegisterPushTokenDto,
  ) {
    return this.notifications.registerToken(user.id, dto.token, dto.platform);
  }

  @Delete('push-tokens/:token')
  removeToken(
    @CurrentUser() user: CurrentUserData,
    @Param('token') token: string,
  ) {
    return this.notifications.removeToken(user.id, token);
  }
}
