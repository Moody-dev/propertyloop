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
import {
  OpsQueueService,
  DERIVED_OPS_KINDS,
  OPS_KIND_SOURCE,
} from './ops-queue.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StaffPermissionsGuard } from '../staff/guards/staff-permissions.guard';
import { RequireStaff } from '../staff/decorators/require-staff.decorator';
import {
  CurrentStaff,
  CurrentStaffData,
} from '../staff/decorators/current-staff.decorator';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { StaffPermission } from '../../generated/prisma/client';

@UseGuards(JwtAuthGuard, StaffPermissionsGuard)
@RequireStaff(StaffPermission.HANDLE_OPS)
@Controller('ops-queue')
export class OpsQueueController {
  constructor(private readonly service: OpsQueueService) {}

  @Get()
  list(@Query('includeResolved') includeResolved?: string) {
    return this.service.list(includeResolved === 'true');
  }

  @Get('summary')
  summary() {
    return this.service.summary();
  }

  /** Which queues are read-only, and what each is read from. */
  @Get('kinds')
  kinds() {
    return { sources: OPS_KIND_SOURCE, derived: DERIVED_OPS_KINDS };
  }

  @Post('tasks')
  createTask(
    @Body() dto: CreateTaskDto,
    @CurrentStaff() staff: CurrentStaffData,
  ) {
    return this.service.createTask(dto, staff.id);
  }

  @Patch('tasks/:id')
  updateTask(@Param('id') id: string, @Body() dto: UpdateTaskDto) {
    return this.service.updateTask(id, dto);
  }

  @Delete('tasks/:id')
  removeTask(@Param('id') id: string) {
    return this.service.removeTask(id);
  }
}
