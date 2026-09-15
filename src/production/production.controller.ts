import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ProductionService } from './production.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StaffPermissionsGuard } from '../staff/guards/staff-permissions.guard';
import { RequireStaff } from '../staff/decorators/require-staff.decorator';
import { CreateShootDto } from './dto/create-shoot.dto';
import { SetShootStageDto, UpdateShootDto } from './dto/update-shoot.dto';
import { CreateContentDto } from './dto/create-content.dto';
import { UpdateContentDto } from './dto/update-content.dto';
import { ShootStage, StaffPermission } from '../../generated/prisma/client';
import { StaffThrottle } from '../staff/staff-throttle';
import {
  CurrentStaff,
  CurrentStaffData,
} from '../staff/decorators/current-staff.decorator';

/**
 * The video production line and the content calendar.
 *
 * One controller because they are the same pipeline seen from two ends: the
 * Ambassador carries 25–30 videos a month and the Secretary is measured on
 * prepping them, and Marketing publishes what comes out.
 */
@UseGuards(JwtAuthGuard, StaffPermissionsGuard)
@RequireStaff(StaffPermission.MANAGE_CONTENT)
@StaffThrottle()
@Controller('production')
export class ProductionController {
  constructor(private readonly service: ProductionService) {}

  @Get('shoots')
  listShoots(@Query('stage') stage?: ShootStage) {
    return this.service.listShoots(stage);
  }

  /** What a shoot can be for. See ProductionService.listPropertyOptions. */
  @Get('properties')
  listPropertyOptions() {
    return this.service.listPropertyOptions();
  }

  @Post('shoots')
  createShoot(
    @Body() dto: CreateShootDto,
    @CurrentStaff() staff: CurrentStaffData,
  ) {
    return this.service.createShoot(dto, staff.id);
  }

  @Patch('shoots/:id')
  updateShoot(
    @Param('id') id: string,
    @Body() dto: UpdateShootDto,
    @CurrentStaff() staff: CurrentStaffData,
  ) {
    return this.service.updateShoot(id, dto, staff.id);
  }

  @Patch('shoots/:id/stage')
  setShootStage(@Param('id') id: string, @Body() dto: SetShootStageDto) {
    return this.service.setShootStage(id, dto.stage);
  }

  @Post('shoots/:id/prepped')
  markPrepped(@Param('id') id: string) {
    return this.service.markPrepped(id);
  }

  @Delete('shoots/:id')
  removeShoot(@Param('id') id: string) {
    return this.service.removeShoot(id);
  }

  @Get('content')
  listContent() {
    return this.service.listContent();
  }

  @Post('content')
  createContent(@Body() dto: CreateContentDto) {
    return this.service.createContent(dto);
  }

  @Patch('content/:id')
  updateContent(@Param('id') id: string, @Body() dto: UpdateContentDto) {
    return this.service.updateContent(id, dto);
  }

  @Delete('content/:id')
  removeContent(@Param('id') id: string) {
    return this.service.removeContent(id);
  }
}
