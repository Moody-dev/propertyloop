import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { ViewingsModule } from '../viewings/viewings.module';
import { AppWaitlistModule } from '../app-waitlist/app-waitlist.module';
import { MessagesModule } from '../messages/messages.module';

@Module({
  imports: [ViewingsModule, AppWaitlistModule, MessagesModule],
  providers: [AdminService, PrismaService],
  controllers: [AdminController],
})
export class AdminModule {}
