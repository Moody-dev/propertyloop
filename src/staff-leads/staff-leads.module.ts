import { Module } from '@nestjs/common';
import { StaffLeadsService } from './staff-leads.service';
import { StaffLeadsController } from './staff-leads.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { StaffModule } from '../staff/staff.module';
import { StaffAlertsModule } from '../staff-alerts/staff-alerts.module';

@Module({
  imports: [StaffAlertsModule, PrismaModule, AuthModule, StaffModule],
  controllers: [StaffLeadsController],
  providers: [StaffLeadsService],
  exports: [StaffLeadsService],
})
export class StaffLeadsModule {}
