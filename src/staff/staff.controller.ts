import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { StaffService } from './staff.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  CurrentUserData,
} from '../auth/decorators/current-user.decorator';
import { StaffPermissionsGuard } from './guards/staff-permissions.guard';
import { RequireStaff } from './decorators/require-staff.decorator';
import { CreateStaffDto } from './dto/create-staff.dto';
import { SetStaffActiveDto, UpdateStaffDto } from './dto/update-staff.dto';
import {
  DEFAULT_STAFF_PERMISSIONS,
  SENSITIVE_PERMISSIONS,
} from './staff-permissions';
import { StaffPermission } from '../../generated/prisma/client';

@Controller('staff')
export class StaffController {
  constructor(private readonly service: StaffService) {}

  /**
   * Whether the signed-in user is staff, and what they may do.
   *
   * Deliberately NOT behind StaffPermissionsGuard — the client calls this to
   * find out whether to show the team portal at all, and a 403 is a worse
   * answer than `null` for that question.
   */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: CurrentUserData) {
    return this.service.me(user.id);
  }

  @UseGuards(JwtAuthGuard, StaffPermissionsGuard)
  @RequireStaff()
  @Get()
  list() {
    return this.service.list();
  }

  /** The permission catalogue, so the UI never hard-codes the list. */
  @UseGuards(JwtAuthGuard, StaffPermissionsGuard)
  @RequireStaff()
  @Get('permissions')
  catalogue() {
    return {
      all: Object.values(StaffPermission),
      sensitive: SENSITIVE_PERMISSIONS,
      defaultsByRole: DEFAULT_STAFF_PERMISSIONS,
    };
  }

  @UseGuards(JwtAuthGuard, StaffPermissionsGuard)
  @RequireStaff()
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @UseGuards(JwtAuthGuard, StaffPermissionsGuard)
  @RequireStaff(StaffPermission.MANAGE_STAFF)
  @Post()
  create(@Body() dto: CreateStaffDto) {
    return this.service.create(dto);
  }

  @UseGuards(JwtAuthGuard, StaffPermissionsGuard)
  @RequireStaff(StaffPermission.MANAGE_STAFF)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateStaffDto) {
    return this.service.update(id, dto);
  }

  @UseGuards(JwtAuthGuard, StaffPermissionsGuard)
  @RequireStaff(StaffPermission.MANAGE_STAFF)
  @Patch(':id/active')
  setActive(@Param('id') id: string, @Body() dto: SetStaffActiveDto) {
    return this.service.setActive(id, dto.active);
  }

  @UseGuards(JwtAuthGuard, StaffPermissionsGuard)
  @RequireStaff(StaffPermission.MANAGE_STAFF)
  @Post(':id/reset-permissions')
  resetPermissions(@Param('id') id: string) {
    return this.service.resetPermissions(id);
  }
}
