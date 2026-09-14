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
import { StaffLeadsService } from './staff-leads.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StaffPermissionsGuard } from '../staff/guards/staff-permissions.guard';
import { RequireStaff } from '../staff/decorators/require-staff.decorator';
import {
  CurrentStaff,
  CurrentStaffData,
} from '../staff/decorators/current-staff.decorator';
import { CreateStaffLeadDto } from './dto/create-staff-lead.dto';
import { UpdateStaffLeadDto } from './dto/update-staff-lead.dto';
import { LeadStatus, StaffPermission } from '../../generated/prisma/client';
import { StaffThrottle } from '../staff/staff-throttle';

@UseGuards(JwtAuthGuard, StaffPermissionsGuard)
@RequireStaff(StaffPermission.MANAGE_LEADS)
@StaffThrottle()
@Controller('staff/leads')
export class StaffLeadsController {
  constructor(private readonly service: StaffLeadsService) {}

  @Get()
  list(
    @Query('status') status?: LeadStatus,
    @Query('ownerId') ownerId?: string,
    @Query('qualified') qualified?: string,
  ) {
    return this.service.list({
      status,
      ownerId,
      qualified: qualified === undefined ? undefined : qualified === 'true',
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(
    @Body() dto: CreateStaffLeadDto,
    @CurrentStaff() staff: CurrentStaffData,
  ) {
    return this.service.create(dto, staff.id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateStaffLeadDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
