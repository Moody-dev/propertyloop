import { Module } from '@nestjs/common';
import { StaffListingsService } from './staff-listings.service';
import { StaffListingsController } from './staff-listings.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { StaffModule } from '../staff/staff.module';
import { StorageModule } from '../storage/storage.module';
import { MediaModule } from '../media/media.module';
import { StaffAlertsModule } from '../staff-alerts/staff-alerts.module';
import { StockAlertsModule } from '../stock-alerts/stock-alerts.module';

@Module({
  imports: [
    StaffAlertsModule,
    StockAlertsModule,
    PrismaModule,
    AuthModule,
    StaffModule,
    StorageModule,
    MediaModule,
  ],
  controllers: [StaffListingsController],
  providers: [StaffListingsService],
  exports: [StaffListingsService],
})
export class StaffListingsModule {}
