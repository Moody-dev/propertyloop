import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ListingStatus, Role } from '../../generated/prisma/client';
import { AdminService } from './admin.service';

@Controller('admin')
@UseGuards(JwtAuthGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  private checkAdminAccess(role: Role) {
    if (role !== Role.ADMIN) {
      throw new ForbiddenException('Admin access required');
    }
  }

  @Get('overview')
  async getOverview(@CurrentUser() user: any) {
    this.checkAdminAccess(user.role);
    return this.adminService.getOverview();
  }

  @Get('users')
  async listUsers(
    @CurrentUser() user: any,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ) {
    this.checkAdminAccess(user.role);
    return this.adminService.listUsers({
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
      search,
    });
  }

  @Patch('users/:id/active')
  async setUserActive(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { isActive: boolean },
  ) {
    this.checkAdminAccess(user.role);
    return this.adminService.setUserActive(id, body.isActive);
  }

  @Get('orders')
  async listOrders(
    @CurrentUser() user: any,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: string,
  ) {
    this.checkAdminAccess(user.role);
    return this.adminService.listOrders({
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
      status,
    });
  }

  @Get('disputes')
  async listDisputes(
    @CurrentUser() user: any,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: string,
  ) {
    this.checkAdminAccess(user.role);
    return this.adminService.listDisputes({
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
      status,
    });
  }

  // ─── Listings (admin moderation) ─────────────────────────────────────────

  @Get('listings')
  async listListings(
    @CurrentUser() user: any,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: ListingStatus,
    @Query('search') search?: string,
  ) {
    this.checkAdminAccess(user.role);
    return this.adminService.listListings({
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
      status,
      search,
    });
  }

  @Patch('listings/:id/status')
  async setListingStatus(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { status: ListingStatus },
  ) {
    this.checkAdminAccess(user.role);
    return this.adminService.setListingStatus(id, body.status);
  }

  // ─── Agents ──────────────────────────────────────────────────────────────

  @Get('agents')
  async listAgents(
    @CurrentUser() user: any,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('verified') verified?: string,
  ) {
    this.checkAdminAccess(user.role);
    return this.adminService.listAgents({
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
      search,
      verified:
        verified === undefined ? undefined : verified === 'true' || verified === '1',
    });
  }

  @Patch('agents/:id/verified')
  async setAgentVerified(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { verified: boolean },
  ) {
    this.checkAdminAccess(user.role);
    return this.adminService.setAgentVerified(id, body.verified);
  }

  // ─── Vendors ─────────────────────────────────────────────────────────────

  @Get('vendors')
  async listVendors(
    @CurrentUser() user: any,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('verified') verified?: string,
  ) {
    this.checkAdminAccess(user.role);
    return this.adminService.listVendors({
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
      search,
      verified:
        verified === undefined ? undefined : verified === 'true' || verified === '1',
    });
  }

  @Patch('vendors/:id/verified')
  async setVendorVerified(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { verified: boolean },
  ) {
    this.checkAdminAccess(user.role);
    return this.adminService.setVendorVerified(id, body.verified);
  }
}
