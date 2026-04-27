import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { ViewingsService } from './viewings.service';
import { CreateViewingDto } from './dto/create-viewing.dto';
import { UpdateViewingDto } from './dto/update-viewing.dto';
import { ListViewingsDto } from './dto/list-viewings.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  CurrentUser,
  CurrentUserData,
} from '../auth/decorators/current-user.decorator';
import { Role } from '../../generated/prisma/client';

@Controller('viewings')
export class ViewingsController {
  constructor(private readonly viewingsService: ViewingsService) {}

  // ─── Public — anyone can request a viewing ──────────────────────────────

  @UseGuards(OptionalJwtAuthGuard)
  @Post()
  create(@Body() dto: CreateViewingDto, @Req() req: Request) {
    const user = req.user as CurrentUserData | undefined;
    return this.viewingsService.create(dto, user?.id);
  }

  // ─── Buyer endpoints ─────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Get('me')
  listMine(
    @CurrentUser() user: CurrentUserData,
    @Query() query: ListViewingsDto,
  ) {
    return this.viewingsService.listForBuyer(user.id, query);
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/:id/cancel')
  cancelMine(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    return this.viewingsService.cancelMine(user.id, id);
  }

  // ─── Agent endpoints ─────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.AGENT)
  @Get()
  list(
    @CurrentUser() user: CurrentUserData,
    @Query() query: ListViewingsDto,
  ) {
    return this.viewingsService.listForAgent(user.id, query);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.AGENT)
  @Patch(':id')
  update(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateViewingDto,
  ) {
    return this.viewingsService.update(user.id, id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.AGENT)
  @Post(':id/cancel')
  cancel(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    return this.viewingsService.cancel(user.id, id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.AGENT)
  @Delete(':id')
  remove(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    return this.viewingsService.remove(user.id, id);
  }
}
