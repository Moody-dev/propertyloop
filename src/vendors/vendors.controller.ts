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
import { B2Service } from '../storage/b2.service';

@Controller('vendors')
export class VendorsController {
  constructor(
    private readonly vendorsService: VendorsService,
    private readonly b2Service: B2Service,
  ) {}

  // ─── Public directory ────────────────────────────────────────────────────

  @Get()
  list(@Query() query: ListVendorsDto) {
    return this.vendorsService.list(query);
  }

  @Get('stats')
  getPublicStats() {
    return this.vendorsService.getPublicStats();
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

  /**
   * Direct-to-R2 presigned PUT for vendor portfolio images and banners.
   * Bypasses the backend proxy so big work-photo files don't hit Render's
   * ~10s edge timeout. Frontend calls this, PUTs the file straight to R2,
   * then PATCHes /vendors/me with the resulting fileUrl.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.VENDOR)
  @Post('me/portfolio/presign')
  async presignPortfolioUpload(
    @CurrentUser() user: CurrentUserData,
    @Body()
    dto: {
      filename: string;
      contentType: string;
      size?: number;
      kind?: 'portfolio' | 'banner';
    },
  ) {
    if (!dto?.filename) throw new Error('filename is required');
    if (!dto?.contentType) throw new Error('contentType is required');
    if (typeof dto.size === 'number' && dto.size > 10 * 1024 * 1024) {
      throw new Error('Image must be 10MB or smaller');
    }
    const folder =
      dto.kind === 'banner'
        ? `vendor-banners/${user.id}`
        : `vendor-portfolio/${user.id}`;
    return this.b2Service.getPresignedPutUrl({
      folder,
      filename: dto.filename,
      contentType: dto.contentType,
      expiresIn: 600,
    });
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
