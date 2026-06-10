import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { B2Service } from '../storage/b2.service';
import { WatermarkService } from './watermark.service';
import { MediaUrlService } from './media-url.service';

/**
 * Serve-time watermark proxy. Given an object key, it streams the original
 * from R2, composites the watermark, and returns the result with long-lived
 * immutable caching (object keys are unique, so a CDN/browser can cache
 * forever). Any failure falls back to redirecting at the untouched original
 * so images never break.
 */
@Controller('media')
export class MediaController {
  constructor(
    private readonly b2: B2Service,
    private readonly watermark: WatermarkService,
    private readonly mediaUrl: MediaUrlService,
  ) {}

  @Get('img')
  async image(@Query('key') key: string, @Res() res: Response) {
    if (!key || !this.mediaUrl.isAllowedKey(key)) {
      throw new BadRequestException('Invalid image key');
    }

    const originalUrl = `${this.b2.getPublicBaseUrl()}/${key}`;

    try {
      const { buffer, contentType } = await this.b2.getObjectBuffer(key);
      const out = await this.watermark.apply(buffer, contentType);
      res.setHeader('Content-Type', out.contentType);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('X-Watermark', 'propertyloop');
      res.end(out.buffer);
    } catch {
      // Never break an image — fall back to the original object.
      res.redirect(302, originalUrl);
    }
  }
}
