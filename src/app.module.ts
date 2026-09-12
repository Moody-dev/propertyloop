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
import { StaffModule } from './staff/staff.module';
import { DealsModule } from './deals/deals.module';
import { DailyLogsModule } from './daily-logs/daily-logs.module';
import { ProductionModule } from './production/production.module';
import { TargetsModule } from './targets/targets.module';
import { OpsQueueModule } from './ops-queue/ops-queue.module';
import { ThreadsModule } from './threads/threads.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 30,
      },
    ]),
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
    StaffModule,
    DealsModule,
    DailyLogsModule,
    ProductionModule,
    TargetsModule,
    OpsQueueModule,
    ThreadsModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
