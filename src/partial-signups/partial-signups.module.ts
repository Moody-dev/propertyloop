import { Module } from '@nestjs/common';
import { PartialSignupsController } from './partial-signups.controller';
import { PartialSignupsService } from './partial-signups.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PartialSignupsController],
  providers: [PartialSignupsService],
  exports: [PartialSignupsService],
})
export class PartialSignupsModule {}
