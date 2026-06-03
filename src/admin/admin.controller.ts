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
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  ListingStatus,
  Role,
  ViewingStatus,
  SubscriptionTier,
  SubscriptionStatus,
} from '../../generated/prisma/client';
import { Response as ExpressResponse } from 'express';
import { Response as ResDecorator } from '@nestjs/common';
import { AdminService } from './admin.service';
import { ViewingsService } from '../viewings/viewings.service';
import { AppWaitlistService } from '../app-waitlist/app-waitlist.service';
import { MessagesService } from '../messages/messages.service';
import { ConversationParticipantRole } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';
import { UpdateListingDto } from '../listings/dto/update-listing.dto';
import {
  FeaturedPropertiesService,
  CreateFeaturedPropertyDto,
  UpdateFeaturedPropertyDto,
} from '../featured-properties/featured-properties.service';
import { KycService } from '../kyc/kyc.service';
import { ReviewKycDto } from '../kyc/dto/review-kyc.dto';
import { KycStatus } from '../../generated/prisma/client';

function mapUserRoleToConversationRole(
  userRole: Role,
): ConversationParticipantRole {
  switch (userRole) {
    case Role.AGENT:
      return ConversationParticipantRole.AGENT;
    case Role.VENDOR:
      return ConversationParticipantRole.VENDOR;
    case Role.ADMIN:
      return ConversationParticipantRole.ADMIN;
    default:
      return ConversationParticipantRole.BUYER;
  }
}

@Controller('admin')
@UseGuards(JwtAuthGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly viewingsService: ViewingsService,
    private readonly appWaitlistService: AppWaitlistService,
    private readonly messagesService: MessagesService,
    private readonly prisma: PrismaService,
    private readonly featuredPropertiesService: FeaturedPropertiesService,
    private readonly kycService: KycService,
  ) {}

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

  @Patch('listings/:id')
  async updateListing(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateListingDto,
  ) {
    this.checkAdminAccess(user.role);
    return this.adminService.adminUpdateListing(id, dto);
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
        verified === undefined
          ? undefined
          : verified === 'true' || verified === '1',
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

  @Patch('agents/:id/subscription')
  async overrideAgentSubscription(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { tier: SubscriptionTier; status: SubscriptionStatus },
  ) {
    this.checkAdminAccess(user.role);
    return this.adminService.overrideAgentSubscription(
      id,
      body.tier,
      body.status,
    );
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
        verified === undefined
          ? undefined
          : verified === 'true' || verified === '1',
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

  // ─── Viewings ────────────────────────────────────────────────────────────

  @Get('viewings')
  async listViewings(
    @CurrentUser() user: any,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: ViewingStatus,
    @Query('upcoming') upcoming?: string,
    @Query('search') search?: string,
  ) {
    this.checkAdminAccess(user.role);
    return this.viewingsService.listAll({
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
      status,
      upcoming: upcoming === 'true' || upcoming === '1',
      search,
    });
  }

  @Patch('viewings/:id/status')
  async setViewingStatus(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { status: ViewingStatus },
  ) {
    this.checkAdminAccess(user.role);
    return this.viewingsService.setStatus(id, body.status);
  }

  @Delete('viewings/:id')
  async deleteViewing(@CurrentUser() user: any, @Param('id') id: string) {
    this.checkAdminAccess(user.role);
    return this.viewingsService.removeAsAdmin(id);
  }

  // ─── App waitlist (mobile app launch subscribers) ──────────────────────

  @Get('app-waitlist')
  async listAppWaitlist(
    @CurrentUser() user: any,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ) {
    this.checkAdminAccess(user.role);
    return this.appWaitlistService.list({
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 100,
      search,
    });
  }

  @Get('app-waitlist/export')
  async exportAppWaitlist(
    @CurrentUser() user: any,
    @ResDecorator() res: ExpressResponse,
  ) {
    this.checkAdminAccess(user.role);
    const csv = await this.appWaitlistService.exportCsv();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="app-waitlist.csv"',
    );
    res.send(csv);
  }

  @Delete('app-waitlist/:id')
  async deleteAppWaitlistEntry(
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    this.checkAdminAccess(user.role);
    return this.appWaitlistService.remove(id);
  }

  // ─── Messaging — admin reaches out to a user ─────────────────────────────
  // POST /admin/messages/start
  // Body: { recipientId: string, listingId?: string, viewingId?: string, text?: string }
  // Creates a conversation between the admin and the recipient (or returns
  // the existing one if they've already spoken). If `viewingId` is supplied,
  // we look up its listing so the conversation is tagged with that listing
  // for context. Returns { conversationId }.
  @Post('messages/start')
  async startConversation(
    @CurrentUser() user: any,
    @Body()
    body: {
      recipientId: string;
      listingId?: string;
      viewingId?: string;
      text?: string;
    },
  ) {
    this.checkAdminAccess(user.role);

    const recipient = await this.prisma.user.findUnique({
      where: { id: body.recipientId },
      select: { id: true, role: true, deletedAt: true },
    });
    if (!recipient || recipient.deletedAt) {
      throw new NotFoundException('Recipient not found');
    }

    // Resolve listingId from viewingId when provided
    let listingId = body.listingId;
    if (!listingId && body.viewingId) {
      const viewing = await this.prisma.viewing.findUnique({
        where: { id: body.viewingId },
        select: { listingId: true },
      });
      if (!viewing) throw new NotFoundException('Viewing not found');
      listingId = viewing.listingId;
    }

    return this.messagesService.createOrFind(user.id, {
      recipientId: recipient.id,
      recipientRole: mapUserRoleToConversationRole(recipient.role),
      senderRole: ConversationParticipantRole.ADMIN,
      listingId,
      text: body.text?.trim() || undefined,
    });
  }

  // ─── Featured / Ad Properties ─────────────────────────────────────────────

  @Get('featured-properties')
  async listFeaturedProperties(@CurrentUser() user: any) {
    this.checkAdminAccess(user.role);
    return this.featuredPropertiesService.listAll();
  }

  @Post('featured-properties')
  async createFeaturedProperty(
    @CurrentUser() user: any,
    @Body() dto: CreateFeaturedPropertyDto,
  ) {
    this.checkAdminAccess(user.role);
    return this.featuredPropertiesService.create(dto);
  }

  @Patch('featured-properties/:id')
  async updateFeaturedProperty(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateFeaturedPropertyDto,
  ) {
    this.checkAdminAccess(user.role);
    return this.featuredPropertiesService.update(id, dto);
  }

  @Delete('featured-properties/:id')
  async deleteFeaturedProperty(
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    this.checkAdminAccess(user.role);
    return this.featuredPropertiesService.remove(id);
  }

  // ─── Identity / KYC review ────────────────────────────────────────────────

  @Get('kyc')
  async listKyc(@CurrentUser() user: any, @Query('status') status?: string) {
    this.checkAdminAccess(user.role);
    const parsed =
      status && status in KycStatus ? (status as KycStatus) : undefined;
    return this.kycService.listForAdmin(parsed);
  }

  @Patch('kyc/:id')
  async reviewKyc(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: ReviewKycDto,
  ) {
    this.checkAdminAccess(user.role);
    return this.kycService.review(user.id, id, dto);
  }
}
