import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { RentalApplicationsService } from './rental-applications.service';
import { CreateRentalApplicationDto } from './dto/create-rental-application.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import {
  CurrentUser,
  CurrentUserData,
} from '../auth/decorators/current-user.decorator';

@Controller('rental-applications')
export class RentalApplicationsController {
  constructor(private readonly service: RentalApplicationsService) {}

  @UseGuards(OptionalJwtAuthGuard)
  @Post()
  create(@Body() dto: CreateRentalApplicationDto, @Req() req: Request) {
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
  @Post(':id/deposit-paid')
  @HttpCode(HttpStatus.OK)
  markDepositPaid(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    return this.service.markDepositPaid(id, user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/sign')
  @HttpCode(HttpStatus.OK)
  markSigned(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    return this.service.markSigned(id, user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    return this.service.cancel(id, user.id);
  }
}
