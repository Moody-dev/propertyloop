import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { VendorsService } from './vendors.service';
import { ListVendorsDto } from './dto/list-vendors.dto';
import { UpdateVendorProfileDto } from './dto/update-vendor-profile.dto';
import { CreateVendorReviewDto } from './dto/create-review.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  CurrentUser,
  CurrentUserData,
} from '../auth/decorators/current-user.decorator';
import { Role } from '../../generated/prisma/client';

@Controller('vendors')
export class VendorsController {
  constructor(private readonly vendorsService: VendorsService) {}

  // ─── Public directory ────────────────────────────────────────────────────

  @Get()
  list(@Query() query: ListVendorsDto) {
    return this.vendorsService.list(query);
  }

  // ─── Authenticated vendor (must come before :id route) ──────────────────

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.VENDOR)
  @Get('me')
  getMe(@CurrentUser() user: CurrentUserData) {
    return this.vendorsService.getMe(user.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.VENDOR)
  @Patch('me')
  updateMe(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: UpdateVendorProfileDto,
  ) {
    return this.vendorsService.updateMe(user.id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.VENDOR)
  @Get('me/stats')
  getStats(@CurrentUser() user: CurrentUserData) {
    return this.vendorsService.getStats(user.id);
  }

  // ─── Public profile + reviews ────────────────────────────────────────────

  @Get(':id')
  getPublicProfile(@Param('id') id: string) {
    return this.vendorsService.getPublicProfile(id);
  }

  @Get(':id/reviews')
  listReviews(@Param('id') id: string) {
    return this.vendorsService.listReviews(id);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Post(':id/reviews')
  createReview(
    @Param('id') id: string,
    @Body() dto: CreateVendorReviewDto,
    @Req() req: Request,
  ) {
    const user = req.user as CurrentUserData | undefined;
    return this.vendorsService.createReview(id, dto, user?.id);
  }
}
