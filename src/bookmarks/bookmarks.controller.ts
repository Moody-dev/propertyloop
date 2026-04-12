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
import { BookmarksService } from './bookmarks.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  CurrentUserData,
} from '../auth/decorators/current-user.decorator';
import { BookmarkType } from '../../generated/prisma/client';

@UseGuards(JwtAuthGuard)
@Controller('bookmarks')
export class BookmarksController {
  constructor(private readonly service: BookmarksService) {}

  @Get()
  list(
    @CurrentUser() user: CurrentUserData,
    @Query('type') type?: BookmarkType,
  ) {
    if (type) return this.service.listByType(user.id, type);
    return this.service.listAll(user.id);
  }

  @Post('toggle')
  toggle(
    @CurrentUser() user: CurrentUserData,
    @Body() body: { entityId: string; type: BookmarkType },
  ) {
    return this.service.toggle(user.id, body);
  }

  @Get('check')
  check(
    @CurrentUser() user: CurrentUserData,
    @Query('entityId') entityId: string,
    @Query('type') type: BookmarkType,
  ) {
    return this.service.isBookmarked(user.id, entityId, type);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    return this.service.remove(user.id, id);
  }
}
