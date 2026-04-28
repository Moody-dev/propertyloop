import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { ViewingsModule } from '../viewings/viewings.module';
import { AppWaitlistModule } from '../app-waitlist/app-waitlist.module';

@Module({
  imports: [ViewingsModule, AppWaitlistModule],
  providers: [AdminService, PrismaService],
  controllers: [AdminController],
})
export class AdminModule {}
