import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    MailModule,
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
