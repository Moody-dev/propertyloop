import { Module } from '@nestjs/common';
import { RentalApplicationsService } from './rental-applications.service';
import { RentalApplicationsController } from './rental-applications.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [RentalApplicationsController],
  providers: [RentalApplicationsService],
  exports: [RentalApplicationsService],
})
export class RentalApplicationsModule {}
