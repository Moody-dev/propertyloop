import { Injectable, Logger } from '@nestjs/common';
// sharp is a CommonJS `export =` module and this project has esModuleInterop
// off, so `import sharp from 'sharp'` emits `sharp.default(...)` (undefined at
// runtime). Use the import-require form, which resolves to the callable.
import sharp = require('sharp');
import { WATERMARK_LOGO_DATA_URI } from './watermark-logo';

/**
 * Composites a subtle, repeating propertyloop logo over an image.
 *
 * Tuning knobs live in WM — opacity, angle, logo size and tile density. The
 * mark scales with image width so thumbnails and full-size photos both get a
 * proportional watermark. Originals in R2 are never modified; this runs at
 * serve time inside the media proxy.
 */
const LOGO_ASPECT = 1695 / 693; // intrinsic logo width / height

const WM = {
  /** Logo width as a fraction of the image width (clamped by min/max px). */
  widthScale: 0.26,
  minWidth: 120,
  maxWidth: 540,
  /** Logo opacity — low enough to stay subtle over most photos. */
  opacity: 0.18,
  angleDeg: -28,
  /** Tile box as multiples of the logo size (controls how dense the repeat is). */
  tileWidthMul: 1.5,
  tileHeightMul: 2.6,
  jpegQuality: 82,
  webpQuality: 78,
} as const;

@Injectable()
export class WatermarkService {
  private readonly logger = new Logger(WatermarkService.name);

  /**
   * Returns the watermarked image. On any failure it returns the original
   * bytes unchanged so a watermark hiccup can never break an image.
   */
  async apply(
    input: Buffer,
    fallbackContentType?: string,
    opts: { width?: number; webp?: boolean } = {},
  ): Promise<{ buffer: Buffer; contentType: string }> {
    try {
      const img = sharp(input, { failOn: 'none', animated: false });
      const meta = await img.metadata();
      const srcWidth = meta.width ?? 0;
      const srcHeight = meta.height ?? 0;
      if (!srcWidth || !srcHeight) {
        return { buffer: input, contentType: fallbackContentType ?? 'image/jpeg' };
      }

      // Never upscale — a request for a width larger than the original serves
      // the original size rather than inventing pixels.
      const width =
        opts.width && opts.width < srcWidth ? opts.width : srcWidth;
      const height = Math.round(srcHeight * (width / srcWidth));

      // Resize before compositing so one decode does both, and the watermark
      // scales with the delivered image rather than the original.
      let pipeline = sharp(input, { failOn: 'none', animated: false });
      if (width !== srcWidth) {
        // Both dimensions are given explicitly so the output matches the
        // overlay exactly; height is the aspect-correct value rounded, so the
        // fill fit distorts by less than a pixel.
        pipeline = pipeline.resize({ width, height, fit: 'fill' });
      }

      const overlay = Buffer.from(this.buildSvg(width, height));
      pipeline = pipeline.composite([{ input: overlay, top: 0, left: 0 }]);

      // Prefer WebP when the client accepts it; otherwise keep the original
      // format where we can and default to JPEG.
      let contentType: string;
      if (opts.webp) {
        pipeline = pipeline.webp({ quality: WM.webpQuality });
        contentType = 'image/webp';
      } else {
        switch (meta.format) {
          case 'png':
            pipeline = pipeline.png();
            contentType = 'image/png';
            break;
          case 'webp':
            pipeline = pipeline.webp({ quality: WM.webpQuality });
            contentType = 'image/webp';
            break;
          default:
            pipeline = pipeline.jpeg({ quality: WM.jpegQuality, mozjpeg: true });
            contentType = 'image/jpeg';
        }
      }

      const buffer = await pipeline.toBuffer();
      return { buffer, contentType };
    } catch (err) {
      this.logger.warn(
        `Watermark failed, serving original: ${(err as Error).message}`,
      );
      return { buffer: input, contentType: fallbackContentType ?? 'image/jpeg' };
    }
  }

  /** A full-bleed SVG that tiles the logo diagonally across the image. */
  private buildSvg(width: number, height: number): string {
    const logoW = Math.round(
      Math.min(WM.maxWidth, Math.max(WM.minWidth, width * WM.widthScale)),
    );
    const logoH = Math.round(logoW / LOGO_ASPECT);
    const tileW = Math.round(logoW * WM.tileWidthMul);
    const tileH = Math.round(logoH * WM.tileHeightMul);
    // Centre the logo within its tile so the repeat looks even.
    const offX = Math.round((tileW - logoW) / 2);
    const offY = Math.round((tileH - logoH) / 2);

    return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs>
    <pattern id="wm" width="${tileW}" height="${tileH}" patternUnits="userSpaceOnUse" patternTransform="rotate(${WM.angleDeg})">
      <image x="${offX}" y="${offY}" width="${logoW}" height="${logoH}" opacity="${WM.opacity}" xlink:href="${WATERMARK_LOGO_DATA_URI}" />
    </pattern>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#wm)"/>
</svg>`;
  }
}
