import { Module } from '@nestjs/common';
import { ViewingsService } from './viewings.service';
import { ViewingsController } from './viewings.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ViewingsController],
  providers: [ViewingsService],
  exports: [ViewingsService],
})
export class ViewingsModule {}
