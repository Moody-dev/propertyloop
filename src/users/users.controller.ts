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
import { UpdateBuyerProfileDto } from './dto/update-buyer-profile.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../../generated/prisma/client';
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

  @UseGuards(RolesGuard)
  @Roles(Role.BUYER)
  @Patch('me/buyer')
  updateBuyerProfile(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: UpdateBuyerProfileDto,
  ) {
    return this.usersService.updateBuyerProfile(user.id, dto);
  }

  @Get('me/referrals')
  getMyReferrals(@CurrentUser() user: CurrentUserData) {
    return this.usersService.getMyReferrals(user.id);
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

  @Patch('me/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivateAccount(@CurrentUser() user: CurrentUserData) {
    return this.usersService.deactivateAccount(user.id);
  }
}
