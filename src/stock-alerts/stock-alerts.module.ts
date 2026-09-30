import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';
import { StockAlertsService } from './stock-alerts.service';

@Module({
  imports: [PrismaModule, MailModule],
  providers: [StockAlertsService],
  exports: [StockAlertsService],
})
export class StockAlertsModule {}
