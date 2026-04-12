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
import { LeadsService } from './leads.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { ListLeadsDto } from './dto/list-leads.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  CurrentUser,
  CurrentUserData,
} from '../auth/decorators/current-user.decorator';
import { Role } from '../../generated/prisma/client';

@Controller('leads')
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  // ─── Public — anyone (logged in or guest) can submit a lead ─────────────

  @UseGuards(OptionalJwtAuthGuard)
  @Post()
  create(@Body() dto: CreateLeadDto, @Req() req: Request) {
    const user = req.user as CurrentUserData | undefined;
    return this.leadsService.create(dto, user?.id);
  }

  // ─── Agent endpoints ─────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.AGENT)
  @Get()
  list(
    @CurrentUser() user: CurrentUserData,
    @Query() query: ListLeadsDto,
  ) {
    return this.leadsService.listForAgent(user.id, query);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.AGENT)
  @Get(':id')
  getOne(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    return this.leadsService.getOne(user.id, id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.AGENT)
  @Patch(':id')
  update(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateLeadDto,
  ) {
    return this.leadsService.update(user.id, id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.AGENT)
  @Delete(':id')
  remove(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    return this.leadsService.remove(user.id, id);
  }
}
