import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { ViewingsModule } from '../viewings/viewings.module';
import { AppWaitlistModule } from '../app-waitlist/app-waitlist.module';
import { MessagesModule } from '../messages/messages.module';
import { FeaturedPropertiesModule } from '../featured-properties/featured-properties.module';
import { KycModule } from '../kyc/kyc.module';
import { VendorJobsModule } from '../vendor-jobs/vendor-jobs.module';
import { AdsModule } from '../ads/ads.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [
    ViewingsModule,
    AppWaitlistModule,
    MessagesModule,
    FeaturedPropertiesModule,
    KycModule,
    VendorJobsModule,
    AdsModule,
    PaymentsModule,
  ],
  providers: [AdminService, PrismaService],
  controllers: [AdminController],
})
export class AdminModule {}
