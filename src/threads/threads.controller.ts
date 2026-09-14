import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ThreadsService, ThreadSubjectKind } from './threads.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StaffPermissionsGuard } from '../staff/guards/staff-permissions.guard';
import { RequireStaff } from '../staff/decorators/require-staff.decorator';
import {
  CurrentUser,
  CurrentUserData,
} from '../auth/decorators/current-user.decorator';
import { CreateThreadDto } from './dto/create-thread.dto';
import { PostMessageDto } from './dto/post-message.dto';
import { ConversationKind } from '../../generated/prisma/client';
import { StaffThrottle } from '../staff/staff-throttle';

/**
 * Internal staff messaging. Any active staff member may use it — there is no
 * separate permission, because a team that cannot talk to each other is not
 * a team.
 */
@UseGuards(JwtAuthGuard, StaffPermissionsGuard)
@RequireStaff()
@StaffThrottle()
@Controller('threads')
export class ThreadsController {
  constructor(private readonly service: ThreadsService) {}

  @Get()
  list(
    @CurrentUser() user: CurrentUserData,
    @Query('kind') kind?: ConversationKind,
  ) {
    return this.service.list(user.id, kind);
  }

  @Get('unread')
  unread(@CurrentUser() user: CurrentUserData) {
    return this.service.unreadCount(user.id);
  }

  @Get('all-staff')
  allStaff(@CurrentUser() user: CurrentUserData) {
    return this.service.allStaffChannel(user.id);
  }

  /** Threads pinned to one record — what a Discuss button opens. */
  @Get('subject/:kind/:id')
  forSubject(@Param('kind') kind: ThreadSubjectKind, @Param('id') id: string) {
    return this.service.listForSubject(kind, id);
  }

  @Get(':id')
  findOne(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.service.findOne(user.id, id);
  }

  @Post()
  create(@CurrentUser() user: CurrentUserData, @Body() dto: CreateThreadDto) {
    return this.service.create(user.id, dto);
  }

  @Post('direct/:otherUserId')
  openDirect(
    @CurrentUser() user: CurrentUserData,
    @Param('otherUserId') otherUserId: string,
  ) {
    return this.service.openDirect(user.id, otherUserId);
  }

  @Post(':id/messages')
  postMessage(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: PostMessageDto,
  ) {
    return this.service.postMessage(user.id, id, dto);
  }

  @Post(':id/read')
  markRead(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.service.markRead(user.id, id);
  }

  @Patch(':id/resolved')
  setResolved(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() body: { resolved: boolean },
  ) {
    return this.service.setResolved(user.id, id, body.resolved);
  }
}
