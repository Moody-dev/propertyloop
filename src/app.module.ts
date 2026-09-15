import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WaitlistModule } from './waitlist/waitlist.module';
import { PrismaModule } from './prisma/prisma.module';
import { MailModule } from './mail/mail.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { AgentsModule } from './agents/agents.module';
import { ListingsModule } from './listings/listings.module';
import { LeadsModule } from './leads/leads.module';
import { ViewingsModule } from './viewings/viewings.module';
import { VendorsModule } from './vendors/vendors.module';
import { VendorJobsModule } from './vendor-jobs/vendor-jobs.module';
import { VendorEarningsModule } from './vendor-earnings/vendor-earnings.module';
import { BookmarksModule } from './bookmarks/bookmarks.module';
import { ProductsModule } from './products/products.module';
import { OrdersModule } from './orders/orders.module';
import { ShortletBookingsModule } from './shortlet-bookings/shortlet-bookings.module';
import { RentalApplicationsModule } from './rental-applications/rental-applications.module';
import { MessagesModule } from './messages/messages.module';
import { StorageModule } from './storage/storage.module';
import { MediaModule } from './media/media.module';
import { PaymentsModule } from './payments/payments.module';
import { AdminModule } from './admin/admin.module';
import { UploadModule } from './upload/upload.module';
import { ReportsModule } from './reports/reports.module';
import { BlocksModule } from './blocks/blocks.module';
import { AppWaitlistModule } from './app-waitlist/app-waitlist.module';
import { PartialSignupsModule } from './partial-signups/partial-signups.module';
import { ValuationsModule } from './valuations/valuations.module';
import { FeaturedPropertiesModule } from './featured-properties/featured-properties.module';
import { OffersModule } from './offers/offers.module';
import { NotificationsModule } from './notifications/notifications.module';
import { KycModule } from './kyc/kyc.module';
import { FeedModule } from './feed/feed.module';
import { AdsModule } from './ads/ads.module';
import { PartnersModule } from './partners/partners.module';
// Team portal — internal staff tooling, never exposed to the marketplace.
import { StaffLeadsModule } from './staff-leads/staff-leads.module';
import { StaffListingsModule } from './staff-listings/staff-listings.module';
import { StaffModule } from './staff/staff.module';
import { DealsModule } from './deals/deals.module';
import { DailyLogsModule } from './daily-logs/daily-logs.module';
import { ProductionModule } from './production/production.module';
import { TargetsModule } from './targets/targets.module';
import { OpsQueueModule } from './ops-queue/ops-queue.module';
import { ThreadsModule } from './threads/threads.module';
import { StaffAlertsModule } from './staff-alerts/staff-alerts.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot({
      throttlers: [
        // Per caller IP. The broad backstop for everything.
        {
          name: 'default',
          ttl: 60000,
          limit: 30,
        },
        // Per ACCOUNT being targeted, not per caller.
        //
        // An IP-only limit punishes the wrong people: a team behind one
        // office NAT shares a single public address, so nine staff signing in
        // at 9am exhaust the allowance and the last few are told their
        // password is wrong. Meanwhile it barely inconveniences an attacker,
        // who can rotate IPs freely.
        //
        // Brute force is aimed at an account, so that is what to count. This
        // holds regardless of how many addresses the attempts come from.
        {
          name: 'account',
          ttl: 60000,
          limit: 8,
          getTracker: (req: Record<string, any>) =>
            Promise.resolve(
              `account:${String(req?.body?.email ?? '')
                .trim()
                .toLowerCase()}`,
            ),
          // Only meaningful where the request names an account.
          skipIf: (context) => {
            const req = context.switchToHttp().getRequest();
            const email = req?.body?.email;
            return typeof email !== 'string' || email.trim() === '';
          },
        },
      ],
    }),
    PrismaModule,
    MailModule,
    StorageModule,
    MediaModule,
    PaymentsModule,
    WaitlistModule,
    AuthModule,
    UsersModule,
    AgentsModule,
    ListingsModule,
    LeadsModule,
    ViewingsModule,
    VendorsModule,
    VendorJobsModule,
    VendorEarningsModule,
    BookmarksModule,
    ProductsModule,
    OrdersModule,
    ShortletBookingsModule,
    RentalApplicationsModule,
    MessagesModule,
    AdminModule,
    UploadModule,
    ReportsModule,
    BlocksModule,
    AppWaitlistModule,
    PartialSignupsModule,
    ValuationsModule,
    FeaturedPropertiesModule,
    OffersModule,
    NotificationsModule,
    KycModule,
    FeedModule,
    AdsModule,
    PartnersModule,
    // Before StaffModule on purpose: /staff/:id would otherwise match
    // /staff/leads and /staff/listings first.
    StaffLeadsModule,
    StaffListingsModule,
    StaffModule,
    DealsModule,
    DailyLogsModule,
    ProductionModule,
    TargetsModule,
    OpsQueueModule,
    ThreadsModule,
    StaffAlertsModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
