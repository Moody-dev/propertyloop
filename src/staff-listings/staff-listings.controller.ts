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
import { StaffListingsService } from './staff-listings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StaffPermissionsGuard } from '../staff/guards/staff-permissions.guard';
import { RequireStaff } from '../staff/decorators/require-staff.decorator';
import {
  CurrentStaff,
  CurrentStaffData,
} from '../staff/decorators/current-staff.decorator';
import { CreateStaffListingDto } from './dto/create-staff-listing.dto';
import { UpdateStaffListingDto } from './dto/update-staff-listing.dto';
import {
  DocumentType,
  ListingStatus,
  StaffPermission,
} from '../../generated/prisma/client';
import { StaffThrottle } from '../staff/staff-throttle';

@UseGuards(JwtAuthGuard, StaffPermissionsGuard)
@RequireStaff(StaffPermission.MANAGE_PROPERTIES)
@StaffThrottle()
@Controller('staff/listings')
export class StaffListingsController {
  constructor(private readonly service: StaffListingsService) {}

  @Get()
  list(
    @Query('status') status?: ListingStatus,
    @Query('includeAgentOwned') includeAgentOwned?: string,
  ) {
    return this.service.list({
      status,
      includeAgentOwned: includeAgentOwned === 'true',
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(
    @Body() dto: CreateStaffListingDto,
    @CurrentStaff() staff: CurrentStaffData,
  ) {
    return this.service.create(dto, staff.id, staff.userId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateStaffListingDto) {
    return this.service.update(id, dto);
  }

  /** Publishing is its own permission — posting stock is not vouching for it. */
  @Patch(':id/status')
  @RequireStaff(StaffPermission.PUBLISH_PROPERTY)
  setStatus(@Param('id') id: string, @Body('status') status: ListingStatus) {
    return this.service.setStatus(id, status);
  }

  @Patch(':id/documents/:type')
  @RequireStaff(StaffPermission.VERIFY_DOCUMENTS)
  setDocumentVerified(
    @Param('id') id: string,
    @Param('type') type: DocumentType,
    @Body('verified') verified: boolean,
  ) {
    return this.service.setDocumentVerified(id, type, verified);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
