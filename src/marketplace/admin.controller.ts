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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StaffPermissionsGuard } from '../staff/guards/staff-permissions.guard';
import { RequireStaff } from '../staff/decorators/require-staff.decorator';
import {
  CurrentStaff,
  CurrentStaffData,
} from '../staff/decorators/current-staff.decorator';
import { StaffPermission } from '../../generated/prisma/client';
import { MarketplaceAdminService } from './admin.service';
import { MarketplaceDisputesService } from './disputes.service';
import {
  AdminUpdateStoreDto,
  RefundOrderDto,
  ResolveDisputeDto,
} from './dto/dispute.dto';

/**
 * Marketplace oversight, for staff holding MANAGE_MARKETPLACE. Verifying
 * stores, setting commission, watching orders and payouts, and resolving
 * refunds and disputes — all money-touching, so every route is gated on the
 * one permission.
 */
@UseGuards(JwtAuthGuard, StaffPermissionsGuard)
@RequireStaff(StaffPermission.MANAGE_MARKETPLACE)
@Controller('marketplace/admin')
export class MarketplaceAdminController {
  constructor(
    private readonly admin: MarketplaceAdminService,
    private readonly disputes: MarketplaceDisputesService,
  ) {}

  @Get('summary')
  summary() {
    return this.admin.summary();
  }

  // ─── Stores ───────────────────────────────────────────────────────────
  @Get('stores')
  listStores() {
    return this.admin.listStores();
  }

  @Patch('stores/:id')
  updateStore(@Param('id') id: string, @Body() dto: AdminUpdateStoreDto) {
    return this.admin.updateStore(id, dto);
  }

  // ─── Orders ───────────────────────────────────────────────────────────
  @Get('orders')
  listOrders(
    @Query('status') status?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.admin.listOrders(status, Number(page) || 1, Number(limit) || 30);
  }

  @Post('orders/:id/refund')
  refund(
    @Param('id') id: string,
    @Body() dto: RefundOrderDto,
    @CurrentStaff() staff: CurrentStaffData,
  ) {
    return this.disputes.refundOrder(id, {
      refundNaira: dto.refundNaira,
      reason: dto.reason,
      staffId: staff.id,
    });
  }

  @Post('orders/:id/settle-owed')
  settleOwed(@Param('id') id: string) {
    return this.admin.settleOwed(id);
  }

  // ─── Disputes ─────────────────────────────────────────────────────────
  @Get('disputes')
  listDisputes(@Query('status') status?: string) {
    return this.disputes.list(status);
  }

  @Post('disputes/:id/resolve')
  resolveDispute(
    @Param('id') id: string,
    @Body() dto: ResolveDisputeDto,
    @CurrentStaff() staff: CurrentStaffData,
  ) {
    return this.disputes.resolve(id, staff.id, dto);
  }
}
