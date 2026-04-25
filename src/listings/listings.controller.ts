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
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ListingsService } from './listings.service';
import { B2Service } from '../storage/b2.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { ListListingsDto } from './dto/list-listings.dto';
import { AddListingDocumentDto } from './dto/add-document.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  CurrentUser,
  CurrentUserData,
} from '../auth/decorators/current-user.decorator';
import { Role } from '../../generated/prisma/client';

@Controller('listings')
export class ListingsController {
  constructor(
    private readonly listingsService: ListingsService,
    private readonly b2Service: B2Service,
  ) {}

  // ─── Public ──────────────────────────────────────────────────────────────

  @Get()
  list(@Query() query: ListListingsDto) {
    return this.listingsService.list(query);
  }

  @Get('stats/:type')
  getStats(@Param('type') type: 'SALE' | 'RENT') {
    return this.listingsService.getStats(type);
  }

  // ─── Agent-owned (must come before :id) ──────────────────────────────────

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.AGENT)
  @Get('me/all')
  listMine(
    @CurrentUser() user: CurrentUserData,
    @Query() query: ListListingsDto,
  ) {
    return this.listingsService.listMine(user.id, query);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.AGENT)
  @Post()
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateListingDto,
  ) {
    return this.listingsService.create(user.id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.AGENT)
  @Post('upload/photo')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  async uploadPhoto(@UploadedFile() file: any) {
    return this.b2Service.uploadFile(file, 'listings');
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.AGENT)
  @Post('upload/video')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }),
  )
  async uploadVideo(@UploadedFile() file: any) {
    return this.b2Service.uploadFile(file, 'listings-videos');
  }

  @Get('slug/:slug')
  getBySlug(@Param('slug') slug: string) {
    return this.listingsService.getBySlug(slug);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.listingsService.getById(id, { incrementView: true });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.AGENT)
  @Patch(':id')
  update(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateListingDto,
  ) {
    return this.listingsService.update(user.id, id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.AGENT)
  @Delete(':id')
  remove(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    return this.listingsService.remove(user.id, id);
  }

  // ─── Documents ────────────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.AGENT)
  @Post(':id/documents')
  addDocument(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: AddListingDocumentDto,
  ) {
    return this.listingsService.addDocument(user.id, id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.AGENT)
  @Delete(':id/documents/:docId')
  removeDocument(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Param('docId') docId: string,
  ) {
    return this.listingsService.removeDocument(user.id, id, docId);
  }
}
