import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { VendorEarningsService } from './vendor-earnings.service';
import { ListEarningsDto } from './dto/list-earnings.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  CurrentUser,
  CurrentUserData,
} from '../auth/decorators/current-user.decorator';
import { Role } from '../../generated/prisma/client';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.VENDOR)
@Controller('vendor-earnings')
export class VendorEarningsController {
  constructor(private readonly service: VendorEarningsService) {}

  @Get('summary')
  summary(@CurrentUser() user: CurrentUserData) {
    return this.service.getSummary(user.id);
  }

  @Get()
  list(
    @CurrentUser() user: CurrentUserData,
    @Query() query: ListEarningsDto,
  ) {
    return this.service.list(user.id, query);
  }
}
