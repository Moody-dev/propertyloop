import { Module } from '@nestjs/common';
import { PartnersService } from './partners.service';
import { PartnersController } from './partners.controller';
import { PartnerDirectoryController } from './partner-directory.controller';
import { PartnerDirectoryService } from './partner-directory.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { StaffModule } from '../staff/staff.module';
import { StaffAlertsModule } from '../staff-alerts/staff-alerts.module';

@Module({
  imports: [
    StaffAlertsModule,
    PrismaModule,
    AuthModule,
    MailModule,
    StaffModule,
  ],
  controllers: [PartnersController, PartnerDirectoryController],
  providers: [PartnersService, PartnerDirectoryService],
  exports: [PartnersService],
})
export class PartnersModule {}
