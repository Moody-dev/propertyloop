import { Module } from '@nestjs/common';
import { BlocksService } from './blocks.service';
import { BlocksController } from './blocks.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ReportsModule } from '../reports/reports.module';

@Module({
  imports: [PrismaModule, AuthModule, ReportsModule],
  controllers: [BlocksController],
  providers: [BlocksService],
})
export class BlocksModule {}
