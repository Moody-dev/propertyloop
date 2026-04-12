import { Module } from '@nestjs/common';
import { VendorJobsService } from './vendor-jobs.service';
import { VendorJobsController } from './vendor-jobs.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [VendorJobsController],
  providers: [VendorJobsService],
  exports: [VendorJobsService],
})
export class VendorJobsModule {}
