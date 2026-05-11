import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  FeaturedPropertiesService,
  CreateFeaturedPropertyDto,
  UpdateFeaturedPropertyDto,
} from './featured-properties.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Role } from '../../generated/prisma/client';

@Controller('featured-properties')
export class FeaturedPropertiesController {
  constructor(private readonly service: FeaturedPropertiesService) {}

  // ── Public ────────────────────────────────────────────────────────────────

  @Get()
  listActive() {
    return this.service.listActive();
  }

  // ── Admin ─────────────────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Get('admin/all')
  listAll(@CurrentUser() user: any) {
    if (user.role !== Role.ADMIN)
      throw new ForbiddenException('Admin access required');
    return this.service.listAll();
  }

  @UseGuards(JwtAuthGuard)
  @Post('admin')
  create(@CurrentUser() user: any, @Body() dto: CreateFeaturedPropertyDto) {
    if (user.role !== Role.ADMIN)
      throw new ForbiddenException('Admin access required');
    return this.service.create(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('admin/:id')
  update(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateFeaturedPropertyDto,
  ) {
    if (user.role !== Role.ADMIN)
      throw new ForbiddenException('Admin access required');
    return this.service.update(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('admin/:id')
  remove(@CurrentUser() user: any, @Param('id') id: string) {
    if (user.role !== Role.ADMIN)
      throw new ForbiddenException('Admin access required');
    return this.service.remove(id);
  }
}
