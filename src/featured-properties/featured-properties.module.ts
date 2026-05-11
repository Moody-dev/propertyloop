import { Module } from '@nestjs/common';
import { FeaturedPropertiesController } from './featured-properties.controller';
import { FeaturedPropertiesService } from './featured-properties.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [FeaturedPropertiesController],
  providers: [FeaturedPropertiesService, PrismaService],
  exports: [FeaturedPropertiesService],
})
export class FeaturedPropertiesModule {}
