import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { WatermarkService } from './watermark.service';
import { MediaUrlService } from './media-url.service';
import { MediaController } from './media.controller';

@Module({
  imports: [StorageModule],
  controllers: [MediaController],
  providers: [WatermarkService, MediaUrlService],
  // MediaUrlService is consumed by listings/featured-properties serializers.
  exports: [MediaUrlService],
})
export class MediaModule {}
