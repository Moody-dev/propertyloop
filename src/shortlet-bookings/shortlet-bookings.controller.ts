import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { ShortletBookingsService } from './shortlet-bookings.service';
import { CreateShortletBookingDto } from './dto/create-shortlet-booking.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import {
  CurrentUser,
  CurrentUserData,
} from '../auth/decorators/current-user.decorator';

@Controller('shortlet-bookings')
export class ShortletBookingsController {
  constructor(private readonly service: ShortletBookingsService) {}

  @UseGuards(OptionalJwtAuthGuard)
  @Post()
  create(@Body() dto: CreateShortletBookingDto, @Req() req: Request) {
    const user = req.user as CurrentUserData | undefined;
    return this.service.create(dto, user?.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  list(
    @CurrentUser() user: CurrentUserData,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.service.listForBuyer(user.id, Number(page) || 1, Number(limit) || 24);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  getById(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    return this.service.getById(id, user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/cancel')
  cancel(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    return this.service.cancel(id, user.id);
  }
}
