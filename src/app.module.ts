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
import { PaymentsModule } from './payments/payments.module';
import { AdminModule } from './admin/admin.module';

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
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
