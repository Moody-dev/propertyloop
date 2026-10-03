/**
 * Add a video to a property from a file on disk.
 *
 * For a clip that arrives over WhatsApp rather than through the portal's
 * upload box. Goes through StaffListingsService.addVideo, so it takes exactly
 * the path the portal takes: the same bucket folder, the same cap of ten, and
 * the same rule that the first video uploaded becomes the one the page leads
 * with.
 *
 * Usage:
 *   npx ts-node scripts/add-listing-video.ts <listingId> "C:\\path\\to\\clip.mp4"
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { StaffListingsService } from '../src/staff-listings/staff-listings.service';

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.webm': 'video/webm',
};

async function main() {
  const [listingId, filePath] = process.argv.slice(2);
  if (!listingId || !filePath) {
    console.error(
      'Usage: npx ts-node scripts/add-listing-video.ts <listingId> <file>',
    );
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) throw new Error(`No such file: ${filePath}`);

  const ext = path.extname(filePath).toLowerCase();
  const mimetype = MIME[ext];
  if (!mimetype) {
    throw new Error(
      `${ext} is not a video this accepts (${Object.keys(MIME).join(', ')})`,
    );
  }

  const buffer = fs.readFileSync(filePath);
  const mb = (buffer.length / 1024 / 1024).toFixed(1);
  // The portal's own route caps a video at 50MB; keep to the same limit so a
  // file that works here also works there.
  if (buffer.length > 50 * 1024 * 1024) {
    throw new Error(`${mb}MB is over the 50MB limit for a video`);
  }
  console.log(`Uploading ${path.basename(filePath)} (${mb}MB, ${mimetype})…`);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const listings = app.get(StaffListingsService);
    const updated = await listings.addVideo(listingId, {
      buffer,
      mimetype,
      originalname: path.basename(filePath),
      size: buffer.length,
    } as never);
    const shaped = updated as unknown as {
      title: string;
      videoUrls?: string[];
      videoUrl?: string | null;
    };
    console.log(`\n✓ Added to "${shaped.title}"`);
    console.log(`  videos now: ${shaped.videoUrls?.length ?? 0}`);
    (shaped.videoUrls ?? []).forEach((u, i) =>
      console.log(`   ${i + 1}. ${u}`),
    );
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
