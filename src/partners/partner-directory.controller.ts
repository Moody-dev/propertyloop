import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseBoolPipe,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PartnerDirectoryService } from './partner-directory.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StaffPermissionsGuard } from '../staff/guards/staff-permissions.guard';
import { RequireStaff } from '../staff/decorators/require-staff.decorator';
import {
  CurrentStaff,
  CurrentStaffData,
} from '../staff/decorators/current-staff.decorator';
import {
  PartnerCommissionStatus,
  PartnerStatus,
  StaffPermission,
} from '../../generated/prisma/client';
import { StaffThrottle } from '../staff/staff-throttle';

/**
 * Team-portal management of the agent partner directory.
 *
 * Note the two different permissions. MANAGE_PARTNERS runs the directory —
 * verify, assign, chase, record what is owed. APPROVE_COMMISSION releases
 * the money, and is held by fewer people, because the person who logs a sale
 * should not be the one who signs off its payout.
 */
@UseGuards(JwtAuthGuard, StaffPermissionsGuard)
@StaffThrottle()
@Controller('staff/partners')
export class PartnerDirectoryController {
  constructor(private readonly service: PartnerDirectoryService) {}

  @RequireStaff(StaffPermission.MANAGE_PARTNERS)
  @Get()
  list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('status') status?: PartnerStatus,
    @Query('owner') owner?: string,
    @Query('search') search?: string,
    @Query('stuckOnly', new DefaultValuePipe(false), ParseBoolPipe)
    stuckOnly?: boolean,
  ) {
    return this.service.list({
      page,
      limit: Math.min(limit, 200),
      status,
      ownerStaffId: owner,
      search,
      stuckOnly,
    });
  }

  @RequireStaff(StaffPermission.MANAGE_PARTNERS)
  @Get('summary')
  summary() {
    return this.service.summary();
  }

  @RequireStaff(StaffPermission.MANAGE_PARTNERS)
  @Patch(':id/status')
  setStatus(@Param('id') id: string, @Body('status') status: PartnerStatus) {
    return this.service.setStatus(id, status);
  }

  @RequireStaff(StaffPermission.MANAGE_PARTNERS)
  @Patch(':id/owner')
  assign(@Param('id') id: string, @Body('staffId') staffId: string | null) {
    return this.service.assign(id, staffId || null);
  }

  @RequireStaff(StaffPermission.MANAGE_PARTNERS)
  @Post(':id/contact')
  logContact(@Param('id') id: string) {
    return this.service.logContact(id);
  }

  @RequireStaff(StaffPermission.MANAGE_PARTNERS)
  @Patch(':id/notes')
  setNotes(@Param('id') id: string, @Body('notes') notes: string) {
    return this.service.setNotes(id, notes ?? '');
  }

  /* ─── Commissions ────────────────────────────────────────────────── */

  @RequireStaff(StaffPermission.MANAGE_PARTNERS)
  @Get('commissions/all')
  listCommissions(@Query('status') status?: PartnerCommissionStatus) {
    return this.service.listCommissions(status);
  }

  /** Record what is owed. Recording is not approving. */
  @RequireStaff(StaffPermission.MANAGE_PARTNERS)
  @Post('commissions')
  record(
    @Body()
    body: {
      leadId: string;
      saleValueNaira: number;
      ratePercent?: number;
      note?: string;
    },
  ) {
    return this.service.recordCommission(body);
  }

  @RequireStaff(StaffPermission.APPROVE_COMMISSION)
  @Patch('commissions/:id/decision')
  decide(
    @CurrentStaff() staff: CurrentStaffData,
    @Param('id') id: string,
    @Body() body: { decision: 'APPROVED' | 'REJECTED'; note?: string },
  ) {
    return this.service.decideCommission(
      id,
      staff.id,
      body.decision,
      body.note,
    );
  }

  @RequireStaff(StaffPermission.APPROVE_COMMISSION)
  @Patch('commissions/:id/paid')
  markPaid(@Param('id') id: string) {
    return this.service.markPaid(id);
  }
}
