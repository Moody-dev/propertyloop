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
import { MessagesService } from './messages.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { ListConversationsDto, ListMessagesDto } from './dto/list-conversations.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  CurrentUserData,
} from '../auth/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  /** List all conversations for the current user */
  @Get('conversations')
  listConversations(
    @CurrentUser() user: CurrentUserData,
    @Query() query: ListConversationsDto,
  ) {
    return this.messagesService.listConversations(user.id, query);
  }

  /** Start or find a conversation with another user */
  @Post('conversations')
  createOrFind(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateConversationDto,
  ) {
    if (!user?.id) {
      throw new BadRequestException('User not authenticated');
    }
    if (!dto?.recipientId) {
      throw new BadRequestException('recipientId is required');
    }
    if (!dto?.recipientRole) {
      throw new BadRequestException('recipientRole is required');
    }
    if (!dto?.senderRole) {
      throw new BadRequestException('senderRole is required');
    }
    return this.messagesService.createOrFind(user.id, dto);
  }

  /** Find-or-create the current user's PropertyLoop support conversation. */
  @Post('support')
  startSupport(@CurrentUser() user: CurrentUserData) {
    if (!user?.id) {
      throw new BadRequestException('User not authenticated');
    }
    return this.messagesService.startSupport(user.id);
  }

  /** Get total unread message count */
  @Get('unread')
  getUnreadCount(@CurrentUser() user: CurrentUserData) {
    return this.messagesService.getUnreadCount(user.id);
  }

  /** Get messages for a conversation */
  @Get('conversations/:id')
  getMessages(
    @CurrentUser() user: CurrentUserData,
    @Param('id') conversationId: string,
    @Query() query: ListMessagesDto,
  ) {
    return this.messagesService.getMessages(user.id, conversationId, query);
  }

  /** Send a message in a conversation */
  @Post('conversations/:id')
  @HttpCode(HttpStatus.CREATED)
  sendMessage(
    @CurrentUser() user: CurrentUserData,
    @Param('id') conversationId: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.messagesService.sendMessage(user.id, conversationId, dto);
  }

  /** Mark a conversation as read */
  @Post('conversations/:id/read')
  @HttpCode(HttpStatus.OK)
  markRead(
    @CurrentUser() user: CurrentUserData,
    @Param('id') conversationId: string,
  ) {
    return this.messagesService.markRead(user.id, conversationId);
  }
}
