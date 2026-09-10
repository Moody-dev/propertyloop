import { Module } from '@nestjs/common';
import { OpsQueueService } from './ops-queue.service';
import { OpsQueueController } from './ops-queue.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { StaffModule } from '../staff/staff.module';

@Module({
  imports: [PrismaModule, AuthModule, StaffModule],
  controllers: [OpsQueueController],
  providers: [OpsQueueService],
  exports: [OpsQueueService],
})
export class OpsQueueModule {}
