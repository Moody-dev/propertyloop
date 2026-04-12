import { Module } from '@nestjs/common';
import { ShortletBookingsService } from './shortlet-bookings.service';
import { ShortletBookingsController } from './shortlet-bookings.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ShortletBookingsController],
  providers: [ShortletBookingsService],
  exports: [ShortletBookingsService],
})
export class ShortletBookingsModule {}
