import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseBoolPipe,
  ParseEnumPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
import { SetListingPhotosDto } from './dto/set-listing-photos.dto';
import { SetListingVideosDto } from './dto/set-listing-videos.dto';
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
  setStatus(
    @Param('id') id: string,
    @Body('status', new ParseEnumPipe(ListingStatus)) status: ListingStatus,
  ) {
    return this.service.setStatus(id, status);
  }

  @Patch(':id/documents/:type')
  @RequireStaff(StaffPermission.VERIFY_DOCUMENTS)
  setDocumentVerified(
    @Param('id') id: string,
    @Param('type', new ParseEnumPipe(DocumentType)) type: DocumentType,
    @Body('verified', ParseBoolPipe) verified: boolean,
  ) {
    return this.service.setDocumentVerified(id, type, verified);
  }

  /**
   * One photo per request — see StaffListingsService.addPhoto. Staff have no
   * AGENT role, so the agent upload routes on /listings refuse them; this is
   * the portal's own, behind MANAGE_PROPERTIES. 10MB, the same as agents'.
   */
  @Post(':id/photos')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  addPhoto(@Param('id') id: string, @UploadedFile() file: any) {
    return this.service.addPhoto(id, file);
  }

  /** Reorder or remove photos; the first becomes the cover. */
  @Patch(':id/photos')
  setPhotos(@Param('id') id: string, @Body() dto: SetListingPhotosDto) {
    return this.service.setPhotos(id, dto.images);
  }

  /** One document per request — PDF, JPG or PNG, 10MB, as agents upload. */
  @Post(':id/documents')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  addDocument(
    @Param('id') id: string,
    @UploadedFile() file: any,
    @Body('type') type?: string,
  ) {
    return this.service.addDocument(id, file, type);
  }

  @Delete(':id/documents/:docId')
  removeDocument(@Param('id') id: string, @Param('docId') docId: string) {
    return this.service.removeDocument(id, docId);
  }

  /** One video per request — 50MB, the same cap agents have. */
  @Post(':id/videos')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }),
  )
  addVideo(@Param('id') id: string, @UploadedFile() file: any) {
    return this.service.addVideo(id, file);
  }

  /** Reorder or remove videos, or add a YouTube / Vimeo link. */
  @Patch(':id/videos')
  setVideos(@Param('id') id: string, @Body() dto: SetListingVideosDto) {
    return this.service.setVideos(id, dto.videoUrls);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
