import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { DailyLogsService, lagosDay } from './daily-logs.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StaffPermissionsGuard } from '../staff/guards/staff-permissions.guard';
import { RequireStaff } from '../staff/decorators/require-staff.decorator';
import {
  CurrentStaff,
  CurrentStaffData,
  staffCan,
} from '../staff/decorators/current-staff.decorator';
import { SaveDailyLogDto } from './dto/save-daily-log.dto';
import { StaffPermission } from '../../generated/prisma/client';
import { StaffThrottle } from '../staff/staff-throttle';

@UseGuards(JwtAuthGuard, StaffPermissionsGuard)
@RequireStaff()
@StaffThrottle()
@Controller('daily-logs')
export class DailyLogsController {
  constructor(private readonly service: DailyLogsService) {}

  /** Today's date as the server understands it, so clients agree on the day. */
  @Get('today')
  today() {
    return { day: lagosDay() };
  }

  @Get('mine')
  mine(@CurrentStaff() staff: CurrentStaffData) {
    return this.service.listForStaff(staff.id);
  }

  @Get('mine/missed')
  missed(@CurrentStaff() staff: CurrentStaffData) {
    return this.service.missedDays(staff.id);
  }

  /** What the records show for me on a day — the panel beside the form. */
  @Get('mine/activity')
  myActivity(
    @CurrentStaff() staff: CurrentStaffData,
    @Query('day') day?: string,
  ) {
    return this.service.dayActivity(staff.id, day ?? lagosDay());
  }

  /**
   * Everyone's entries for one day. Managers only — a daily log is somebody
   * writing candidly about what is blocking them, and that is not the sort of
   * thing the whole company should browse.
   */
  /** Everyone's entries for a recent window. Managers only, as below. */
  @RequireStaff(StaffPermission.VIEW_ALL_LOGS)
  @Get('recent')
  recent(@Query('days') days?: string) {
    const n = Number(days);
    return this.service.listRecent(Number.isFinite(n) ? n : 14);
  }

  @RequireStaff(StaffPermission.VIEW_ALL_LOGS)
  @Get('day/:day')
  forDay(@Param('day') day: string) {
    return this.service.listForDay(day);
  }

  @RequireStaff(StaffPermission.VIEW_ALL_LOGS)
  @Get('staff/:staffId')
  forStaff(@Param('staffId') staffId: string) {
    return this.service.listForStaff(staffId);
  }

  /**
   * File or amend your own entry. There is deliberately no way to write
   * somebody else's log, whatever permissions you hold — a log signed by one
   * person and written by another is worse than no log.
   */
  @Put(':day')
  save(
    @CurrentStaff() staff: CurrentStaffData,
    @Param('day') day: string,
    @Body() dto: SaveDailyLogDto,
  ) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      throw new ForbiddenException('day must be YYYY-MM-DD');
    }
    if (day > lagosDay()) {
      throw new ForbiddenException('Cannot file a log for a future day');
    }
    return this.service.save(staff.id, day, dto);
  }

  @Delete(':day')
  remove(@CurrentStaff() staff: CurrentStaffData, @Param('day') day: string) {
    return this.service.remove(staff.id, day);
  }

  /** Exposed so a manager can see whether someone may read all logs. */
  @Get('can-read-all')
  canReadAll(@CurrentStaff() staff: CurrentStaffData) {
    return { canReadAll: staffCan(staff, StaffPermission.VIEW_ALL_LOGS) };
  }
}
