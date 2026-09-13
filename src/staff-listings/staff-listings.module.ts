import { Module } from '@nestjs/common';
import { StaffListingsService } from './staff-listings.service';
import { StaffListingsController } from './staff-listings.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { StaffModule } from '../staff/staff.module';

@Module({
  imports: [PrismaModule, AuthModule, StaffModule],
  controllers: [StaffListingsController],
  providers: [StaffListingsService],
  exports: [StaffListingsService],
})
export class StaffListingsModule {}
