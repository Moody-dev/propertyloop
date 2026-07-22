import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { BlocksService } from './blocks.service';
import { CreateBlockDto } from './dto/create-block.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  CurrentUserData,
} from '../auth/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('blocks')
export class BlocksController {
  constructor(private readonly blocksService: BlocksService) {}

  @Get()
  listBlocked(@CurrentUser() user: CurrentUserData) {
    return this.blocksService.listBlocked(user.id);
  }

  @Post()
  block(@CurrentUser() user: CurrentUserData, @Body() dto: CreateBlockDto) {
    return this.blocksService.block(user.id, dto);
  }

  @Delete(':userId')
  unblock(
    @CurrentUser() user: CurrentUserData,
    @Param('userId') userId: string,
  ) {
    return this.blocksService.unblock(user.id, userId);
  }
}
