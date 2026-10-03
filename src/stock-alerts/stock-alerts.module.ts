import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';
import { StockAlertsService } from './stock-alerts.service';
import { HouseEnquiryService } from './house-enquiry.service';
import { StaffAlertsModule } from '../staff-alerts/staff-alerts.module';

@Module({
  imports: [PrismaModule, MailModule, StaffAlertsModule],
  providers: [StockAlertsService, HouseEnquiryService],
  exports: [StockAlertsService, HouseEnquiryService],
})
export class StockAlertsModule {}
