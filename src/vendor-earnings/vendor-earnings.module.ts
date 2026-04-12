import { Module } from '@nestjs/common';
import { VendorEarningsService } from './vendor-earnings.service';
import { VendorEarningsController } from './vendor-earnings.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [VendorEarningsController],
  providers: [VendorEarningsService],
  exports: [VendorEarningsService],
})
export class VendorEarningsModule {}
