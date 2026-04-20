import { Module } from '@nestjs/common';
import { VendorJobsService } from './vendor-jobs.service';
import { VendorJobsController } from './vendor-jobs.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [PrismaModule, AuthModule, PaymentsModule],
  controllers: [VendorJobsController],
  providers: [VendorJobsService],
  exports: [VendorJobsService],
})
export class VendorJobsModule {}
