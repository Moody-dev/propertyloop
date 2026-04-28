import { Module } from '@nestjs/common';
import { AppWaitlistController } from './app-waitlist.controller';
import { AppWaitlistService } from './app-waitlist.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AppWaitlistController],
  providers: [AppWaitlistService],
  exports: [AppWaitlistService],
})
export class AppWaitlistModule {}
