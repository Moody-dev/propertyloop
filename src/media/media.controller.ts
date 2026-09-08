import {
  BadRequestException,
  Controller,
  Get,
  Headers,
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
/**
 * Renderable widths. Cards ask for the small end, detail pages the large; a
 * request for anything else serves the original size.
 */
const ALLOWED_WIDTHS = new Set([320, 480, 640, 960, 1280, 1600, 2048]);

@Controller('media')
export class MediaController {
  constructor(
    private readonly b2: B2Service,
    private readonly watermark: WatermarkService,
    private readonly mediaUrl: MediaUrlService,
  ) {}

  @Get('img')
  async image(
    @Query('key') key: string,
    @Query('w') w: string,
    @Headers('accept') accept: string,
    @Res() res: Response,
  ) {
    if (!key || !this.mediaUrl.isAllowedKey(key)) {
      throw new BadRequestException('Invalid image key');
    }

    const originalUrl = `${this.b2.getPublicBaseUrl()}/${key}`;
    // Only these widths are rendered. An open `w` would let anyone mint
    // unlimited distinct renders of the same photo, each costing a decode and
    // its own cache entry.
    const width = ALLOWED_WIDTHS.has(Number(w)) ? Number(w) : undefined;
    const webp = (accept ?? '').includes('image/webp');

    try {
      const { buffer, contentType } = await this.b2.getObjectBuffer(key);
      const out = await this.watermark.apply(buffer, contentType, {
        width,
        webp,
      });
      res.setHeader('Content-Type', out.contentType);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      // The response body depends on Accept, so a cache must key on it or it
      // will hand WebP to a client that asked for JPEG.
      res.setHeader('Vary', 'Accept');
      res.setHeader('X-Watermark', 'propertyloop');
      res.end(out.buffer);
    } catch {
      // Never break an image — fall back to the original object.
      res.redirect(302, originalUrl);
    }
  }
}
