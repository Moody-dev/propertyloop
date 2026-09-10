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
import { DealsService } from './deals.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StaffPermissionsGuard } from '../staff/guards/staff-permissions.guard';
import { RequireStaff } from '../staff/decorators/require-staff.decorator';
import { CreateDealDto } from './dto/create-deal.dto';
import { SetDealStageDto, UpdateDealDto } from './dto/update-deal.dto';
import { ListDealsDto } from './dto/list-deals.dto';
import { StaffPermission } from '../../generated/prisma/client';

@UseGuards(JwtAuthGuard, StaffPermissionsGuard)
@RequireStaff(StaffPermission.MANAGE_DEALS)
@Controller('deals')
export class DealsController {
  constructor(private readonly service: DealsService) {}

  @Get()
  list(@Query() dto: ListDealsDto) {
    return this.service.list(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/delete-impact')
  deleteImpact(@Param('id') id: string) {
    return this.service.deleteImpact(id);
  }

  @Post()
  create(@Body() dto: CreateDealDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDealDto) {
    return this.service.update(id, dto);
  }

  @Patch(':id/stage')
  setStage(@Param('id') id: string, @Body() dto: SetDealStageDto) {
    return this.service.setStage(id, dto.stage);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
