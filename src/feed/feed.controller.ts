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
import { FeedService } from './feed.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import {
  CurrentUser,
  CurrentUserData,
} from '../auth/decorators/current-user.decorator';
import { CreateFeedPostDto } from './dto/create-post.dto';
import { CreateFeedCommentDto } from './dto/create-comment.dto';

@Controller('feed')
export class FeedController {
  constructor(private readonly service: FeedService) {}

  // Public (viewer-aware when a token is supplied)

  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  list(
    @CurrentUser() user: CurrentUserData | undefined,
    @Query('filter') filter?: string,
    @Query('hashtag') hashtag?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listPosts({
      viewerId: user?.id,
      filter,
      hashtag,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get('meta')
  meta(@CurrentUser() user: CurrentUserData | undefined) {
    return this.service.meta(user?.id);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get('users/:id')
  userProfile(
    @CurrentUser() user: CurrentUserData | undefined,
    @Param('id') id: string,
  ) {
    return this.service.getUserProfile(id, user?.id);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get('users/:id/posts')
  userPosts(
    @CurrentUser() user: CurrentUserData | undefined,
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listPosts({
      viewerId: user?.id,
      authorId: id,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id/comments')
  comments(@Param('id') id: string) {
    return this.service.listComments(id);
  }

  // Authenticated

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@CurrentUser() user: CurrentUserData, @Body() dto: CreateFeedPostDto) {
    return this.service.createPost(user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.service.deletePost(user.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/like')
  like(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.service.toggleLike(user.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/save')
  save(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.service.toggleSave(user.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/vote')
  vote(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() body: { optionId: string },
  ) {
    return this.service.vote(user.id, id, body.optionId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/comments')
  comment(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: CreateFeedCommentDto,
  ) {
    return this.service.createComment(user.id, id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/report')
  report(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.service.reportPost(user.id, id, body?.reason);
  }

  @UseGuards(JwtAuthGuard)
  @Post('follow/:userId')
  follow(
    @CurrentUser() user: CurrentUserData,
    @Param('userId') userId: string,
  ) {
    return this.service.toggleFollow(user.id, userId);
  }
}
