import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { VendorJobsService } from './vendor-jobs.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { ListJobsDto } from './dto/list-jobs.dto';
import { CompleteJobDto } from './dto/complete-job.dto';
import { DisputeJobDto } from './dto/dispute-job.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  CurrentUser,
  CurrentUserData,
} from '../auth/decorators/current-user.decorator';
import { Role } from '../../generated/prisma/client';

@Controller('vendor-jobs')
export class VendorJobsController {
  constructor(private readonly vendorJobsService: VendorJobsService) {}

  // ─── Public / buyer — create a booking ──────────────────────────────────

  @UseGuards(OptionalJwtAuthGuard)
  @Post()
  createBooking(@Body() dto: CreateBookingDto, @Req() req: Request) {
    const user = req.user as CurrentUserData | undefined;
    return this.vendorJobsService.createBooking(dto, user?.id);
  }

  // ─── Buyer-side list — must come before :id to avoid route shadowing ────

  @UseGuards(JwtAuthGuard)
  @Get('mine')
  listMine(
    @CurrentUser() user: CurrentUserData,
    @Query() query: ListJobsDto,
  ) {
    return this.vendorJobsService.listForBuyer(user.id, query);
  }

  // ─── Vendor dashboard — list own jobs ───────────────────────────────────

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.VENDOR)
  @Get()
  list(
    @CurrentUser() user: CurrentUserData,
    @Query() query: ListJobsDto,
  ) {
    return this.vendorJobsService.listForVendor(user.id, query);
  }

  // ─── Single job (vendor or buyer on the job) ────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  getOne(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    return this.vendorJobsService.getOne(id, user.id);
  }

  // ─── Vendor state transitions ───────────────────────────────────────────

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.VENDOR)
  @Patch(':id/accept')
  accept(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    return this.vendorJobsService.accept(user.id, id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.VENDOR)
  @Patch(':id/decline')
  decline(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    return this.vendorJobsService.decline(user.id, id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.VENDOR)
  @Patch(':id/start')
  start(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    return this.vendorJobsService.start(user.id, id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.VENDOR)
  @Patch(':id/complete')
  complete(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: CompleteJobDto,
  ) {
    return this.vendorJobsService.complete(user.id, id, dto);
  }

  // ─── Buyer state transitions ────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  confirm(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    return this.vendorJobsService.confirm(user.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/dispute')
  @HttpCode(HttpStatus.OK)
  dispute(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: DisputeJobDto,
  ) {
    return this.vendorJobsService.dispute(user.id, id, dto);
  }
}
