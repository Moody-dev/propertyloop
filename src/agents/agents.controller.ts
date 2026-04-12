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
import { AgentsService } from './agents.service';
import { ListAgentsDto } from './dto/list-agents.dto';
import { UpdateAgentProfileDto } from './dto/update-agent-profile.dto';
import { CreateAgentReviewDto } from './dto/create-review.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  CurrentUser,
  CurrentUserData,
} from '../auth/decorators/current-user.decorator';
import { Role } from '../../generated/prisma/client';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';

@Controller('agents')
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  // ─── Public ──────────────────────────────────────────────────────────────

  @Get()
  list(@Query() query: ListAgentsDto) {
    return this.agentsService.list(query);
  }

  // ─── Authenticated agent (must come before :id route) ────────────────────

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.AGENT)
  @Get('me')
  getMe(@CurrentUser() user: CurrentUserData) {
    return this.agentsService.getMe(user.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.AGENT)
  @Patch('me')
  updateMe(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: UpdateAgentProfileDto,
  ) {
    return this.agentsService.updateMe(user.id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.AGENT)
  @Get('me/stats')
  getStats(@CurrentUser() user: CurrentUserData) {
    return this.agentsService.getStats(user.id);
  }

  // ─── Public profile + reviews ────────────────────────────────────────────

  @Get(':id')
  getPublicProfile(@Param('id') id: string) {
    return this.agentsService.getPublicProfile(id);
  }

  @Get(':id/reviews')
  listReviews(@Param('id') id: string) {
    return this.agentsService.listReviews(id);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Post(':id/reviews')
  createReview(
    @Param('id') id: string,
    @Body() dto: CreateAgentReviewDto,
    @Req() req: Request,
  ) {
    const user = req.user as CurrentUserData | undefined;
    return this.agentsService.createReview(id, dto, user?.id);
  }
}
