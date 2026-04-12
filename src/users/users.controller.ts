import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  CurrentUserData,
} from '../auth/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getProfile(@CurrentUser() user: CurrentUserData) {
    return this.usersService.getProfile(user.id);
  }

  @Patch('me')
  updateProfile(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(user.id, dto);
  }

  @Get('me/settings')
  getSettings(@CurrentUser() user: CurrentUserData) {
    return this.usersService.getSettings(user.id);
  }

  @Patch('me/settings')
  updateSettings(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: UpdateSettingsDto,
  ) {
    return this.usersService.updateSettings(user.id, dto);
  }

  @Delete('me')
  @HttpCode(HttpStatus.OK)
  deleteAccount(@CurrentUser() user: CurrentUserData) {
    return this.usersService.softDeleteAccount(user.id);
  }
}
