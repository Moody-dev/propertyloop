import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ReportsService } from './reports.service';
import { CreateReportDto } from './dto/create-report.dto';
import { ListReportsDto } from './dto/list-reports.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import {
  CurrentUser,
  CurrentUserData,
} from '../auth/decorators/current-user.decorator';
import { Role } from '../../generated/prisma/client';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  /** Submit a report — any authenticated user, or anonymous */
  @UseGuards(OptionalJwtAuthGuard)
  @Post()
  create(
    @Body() dto: CreateReportDto,
    @CurrentUser() user?: CurrentUserData,
  ) {
    return this.reportsService.create(dto, user?.id);
  }

  /** List all reports — admin only */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get()
  list(@Query() query: ListReportsDto) {
    return this.reportsService.list(query);
  }

  /** Update report status / add admin note — admin only */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateReportDto) {
    return this.reportsService.update(id, dto);
  }
}
