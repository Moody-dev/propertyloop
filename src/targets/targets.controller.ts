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
import { TargetsService, METRIC_KEYS } from './targets.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StaffPermissionsGuard } from '../staff/guards/staff-permissions.guard';
import { RequireStaff } from '../staff/decorators/require-staff.decorator';
import {
  CurrentStaff,
  CurrentStaffData,
  staffCan,
} from '../staff/decorators/current-staff.decorator';
import { CreateTargetDto } from './dto/create-target.dto';
import { RollForwardDto, UpdateTargetDto } from './dto/update-target.dto';
import { StaffPermission, TargetUnit } from '../../generated/prisma/client';
import { StaffThrottle } from '../staff/staff-throttle';

@UseGuards(JwtAuthGuard, StaffPermissionsGuard)
@RequireStaff()
@StaffThrottle()
@Controller('targets')
export class TargetsController {
  constructor(private readonly service: TargetsService) {}

  /** The derivations available, so the UI never guesses a metric key. */
  @Get('metrics')
  metrics() {
    return { keys: METRIC_KEYS };
  }

  @Get('mine')
  mine(
    @CurrentStaff() staff: CurrentStaffData,
    @Query('period') period?: string,
  ) {
    return this.service.listForStaff(staff.id, period);
  }

  /**
   * Everyone's targets. Naira figures are stripped for anyone without
   * VIEW_REVENUE — the scorecard should stay readable without exposing the
   * company's money to everyone who can see a progress bar.
   */
  @RequireStaff(StaffPermission.VIEW_ALL_TARGETS)
  @Get()
  async list(
    @CurrentStaff() staff: CurrentStaffData,
    @Query('period') period?: string,
  ) {
    const targets = await this.service.list(period);
    if (staffCan(staff, StaffPermission.VIEW_REVENUE)) return targets;

    return targets.map((t) =>
      t.unit === TargetUnit.NAIRA
        ? { ...t, actual: null, min: null, max: null, hidden: true }
        : { ...t, hidden: false },
    );
  }

  @RequireStaff(StaffPermission.VIEW_ALL_TARGETS)
  @Get('snapshot')
  snapshot(@Query('period') period?: string) {
    return this.service.snapshot(period);
  }

  @RequireStaff(StaffPermission.MANAGE_TARGETS)
  @Post()
  create(@Body() dto: CreateTargetDto) {
    return this.service.create(dto);
  }

  @RequireStaff(StaffPermission.MANAGE_TARGETS)
  @Post('roll-forward')
  rollForward(@Body() dto: RollForwardDto) {
    return this.service.rollForward(dto.from, dto.to);
  }

  @RequireStaff(StaffPermission.MANAGE_TARGETS)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTargetDto) {
    return this.service.update(id, dto);
  }

  @RequireStaff(StaffPermission.MANAGE_TARGETS)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
