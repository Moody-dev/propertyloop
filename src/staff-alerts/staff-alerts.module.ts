import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { StaffModule } from '../staff/staff.module';
import { StaffAlertsService } from './staff-alerts.service';
import { StaffPushController } from './staff-push.controller';

@Module({
  imports: [PrismaModule, AuthModule, StaffModule],
  controllers: [StaffPushController],
  providers: [StaffAlertsService],
  exports: [StaffAlertsService],
})
export class StaffAlertsModule {}
