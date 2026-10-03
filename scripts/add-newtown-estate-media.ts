/**
 * Add the estate artwork and the marketing video to the Newtown Estate stock.
 *
 * The three listings created by post-newtown-estate.ts share one estate, so
 * they share its media: the same gallery and the same video on each.
 *
 * ⚠  Writes to the LIVE database and LIVE storage. DRY RUN by default.
 *
 *    npx ts-node scripts/add-newtown-estate-media.ts --hero=a.png --flyer=b.png --video=c.mp4
 *    npx ts-node scripts/add-newtown-estate-media.ts ... --confirm
 *
 * The hero becomes the cover — the website, the app and the stock alert email
 * all lead with it.
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

/** The three Newtown Estate listings, as created by post-newtown-estate.ts. */
const LISTING_IDS = [
  'cmus5624w000014uajkza1ub7', // 2-bed terrace
  'cmus562ej000114uavoqgvp7z', // 3-bed semi-detached
  'cmus562md000214uav8n6wldl', // 3-bed fully detached
];

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
};

type Upload = { label: string; filePath: string; key: string; url: string; buffer: Buffer; contentType: string };

function prepare(label: string, filePath: string, folder: string): Upload {
  if (!fs.existsSync(filePath)) throw new Error(`No such file: ${filePath}`);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  if (!contentType) throw new Error(`Unsupported file type for ${label}: ${ext}`);
  const publicBase = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');
  const key = `${folder}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
  return {
    label,
    filePath,
    key,
    url: `${publicBase}/${key}`,
    buffer: fs.readFileSync(filePath),
    contentType,
  };
}

function arg(args: string[], name: string): string | undefined {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found?.split('=').slice(1).join('=');
}

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes('--confirm');

  const heroPath = arg(args, 'hero');
  const flyerPath = arg(args, 'flyer');
  const videoPath = arg(args, 'video');
  // --append adds artwork to the gallery and leaves the cover and video alone,
  // for media that arrives after the listing is already up.
  const appendPath = arg(args, 'append');
  if (!heroPath && !appendPath) {
    throw new Error(
      'Pass --hero=<image> (the new cover) or --append=<image> (added to the gallery)',
    );
  }

  const uploads: Upload[] = [
    ...(heroPath ? [prepare('hero (cover)', heroPath, 'listings')] : []),
    ...(flyerPath ? [prepare('flyer', flyerPath, 'listings')] : []),
    ...(appendPath ? [prepare('append', appendPath, 'listings')] : []),
    ...(videoPath ? [prepare('video', videoPath, 'listings/video')] : []),
  ];

  console.log('Newtown Estate — media\n');
  for (const u of uploads) {
    console.log(
      `  ${u.label.padEnd(12)} ${path.basename(u.filePath)}  (${(u.buffer.length / 1024 / 1024).toFixed(1)} MB, ${u.contentType})`,
    );
    console.log(`               → ${u.url}`);
  }
  console.log(`\nApplied to ${LISTING_IDS.length} listings.`);

  if (!confirm) {
    console.log('\nDry run. Nothing uploaded, nothing written. Re-run with --confirm.');
    return;
  }

  if (!(process.env.R2_PUBLIC_URL || '').trim()) {
    throw new Error('R2_PUBLIC_URL is not set');
  }
  for (const v of ['R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME']) {
    if (!process.env[v]) throw new Error(`${v} is not set`);
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: (process.env.DIRECT_URL || process.env.DATABASE_URL)!,
    }),
  } as any);

  try {
    const s3 = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT!,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });

    for (const u of uploads) {
      console.log(`Uploading ${u.label}…`);
      await s3.send(
        new PutObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME!,
          Key: u.key,
          Body: u.buffer,
          ContentType: u.contentType,
        }),
      );
      console.log(`✓ ${u.url}`);
    }

    // Only a --hero moves the cover, and only a --video replaces the video;
    // an --append run must leave both exactly as they are.
    const cover = uploads.find((u) => u.label === 'hero (cover)')?.url;
    const appended = uploads
      .filter((u) => u.label === 'append')
      .map((u) => u.url);
    const leading = uploads
      .filter((u) => u.contentType.startsWith('image/') && u.label !== 'append')
      .map((u) => u.url);
    const video = uploads.find((u) => u.contentType.startsWith('video/'))?.url;

    for (const id of LISTING_IDS) {
      const existing = await prisma.listing.findUnique({
        where: { id },
        select: { id: true, title: true, images: true },
      });
      if (!existing) {
        console.warn(`! ${id} not found — skipped`);
        continue;
      }
      // New artwork leads, appended artwork goes last, and whatever was
      // already on the listing keeps its place in between rather than being
      // thrown away.
      const kept = existing.images.filter(
        (i) => !leading.includes(i) && !appended.includes(i),
      );
      const images = [...leading, ...kept, ...appended];
      await prisma.listing.update({
        where: { id },
        data: {
          images,
          ...(cover && {
            coverImage: cover,
            // The player needs a still; the cover is the one image guaranteed
            // to exist and to match what the card already shows.
            videoThumbnail: cover,
          }),
          ...(video && { videoUrl: video, videoUrls: [video] }),
        },
      });
      console.log(`✓ ${existing.title}`);
      console.log(`    ${images.length} photo(s)${video ? ' + video' : ''}`);
    }
    console.log('\nDone.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
