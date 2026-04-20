import {
  Controller,
  Get,
  Query,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Role } from '../../generated/prisma/client';
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
      page: page || 1,
      limit: limit || 50,
      search,
    });
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
      page: page || 1,
      limit: limit || 50,
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
      page: page || 1,
      limit: limit || 50,
      status,
    });
  }
}
