/**
 * Converts HEIC/HEIF objects in R2 to JPEG, in place.
 *
 * Photos taken on an iPhone with "High Efficiency" enabled arrive as HEIC. The
 * upload path stored them under a .jpg key and the media proxy serves them as
 * image/jpeg, but the bytes are still HEIC — and only Safari can decode that.
 * Every other browser fails the <img> load and falls back to the PropertyLoop
 * banner, so affected listings show branding instead of the property.
 * WatermarkService can't read them either: sharp throws, the catch returns the
 * original buffer untouched, so these images aren't even watermarked.
 *
 * Each object is rewritten under its own key, so listing.imageUrls needs no
 * migration — the same URL simply starts returning a decodable JPEG.
 *
 * sharp reads HEIC metadata but cannot decode the pixels: its prebuilt binary
 * ships libheif without the HEVC codec (patent licensing). heic-convert does
 * the decode in pure JS, and sharp re-encodes for consistent quality/EXIF.
 *
 * Usage:
 *   npx ts-node scripts/backfill-heic-images.ts                 # dry run, all objects
 *   npx ts-node scripts/backfill-heic-images.ts --prefix listings/
 *   npx ts-node scripts/backfill-heic-images.ts --apply         # actually rewrite
 *   npx ts-node scripts/backfill-heic-images.ts --apply --limit 5
 *
 * Dry run by default. Originals are copied to `heic-originals/<key>` before a
 * key is overwritten, and an existing backup is never replaced, so the script
 * is safe to re-run and the pre-conversion bytes stay recoverable.
 */
import 'dotenv/config';
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  CopyObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import sharp = require('sharp');

// heic-convert ships no type declarations and this project has esModuleInterop
// off, so it comes in through require with a hand-written signature.
const heicConvert = require('heic-convert') as (opts: {
  buffer: Buffer;
  format: 'JPEG' | 'PNG';
  quality?: number;
}) => Promise<ArrayBuffer>;

const BACKUP_PREFIX = 'heic-originals/';

// ISO-BMFF brands that mean "HEIC/HEIF still image". `avif` is deliberately
// absent: it is also ISO-BMFF but every current browser renders it natively.
const HEIF_BRANDS = new Set([
  'heic',
  'heix',
  'heim',
  'heis',
  'hevc',
  'hevm',
  'hevs',
  'mif1',
  'msf1',
]);

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

const BUCKET = process.env.R2_BUCKET_NAME!;

interface Args {
  prefix: string;
  apply: boolean;
  limit: number;
  concurrency: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const flag = (name: string) => argv.includes(`--${name}`);
  const value = (name: string, fallback: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  return {
    prefix: value('prefix', ''),
    apply: flag('apply'),
    limit: parseInt(value('limit', '0'), 10),
    concurrency: Math.max(1, parseInt(value('concurrency', '4'), 10)),
  };
}

async function streamToBuffer(body: any): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  if (typeof body.transformToByteArray === 'function') {
    return Buffer.from(await body.transformToByteArray());
  }
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer>) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** Reads the ISO-BMFF brand without pulling the whole object down. */
function heifBrand(head: Buffer): string | null {
  if (head.length < 12) return null;
  if (head.toString('latin1', 4, 8) !== 'ftyp') return null;
  const brand = head.toString('latin1', 8, 12);
  return HEIF_BRANDS.has(brand) ? brand : null;
}

async function listAllKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix || undefined,
        ContinuationToken: token,
        MaxKeys: 1000,
      }),
    );
    for (const o of res.Contents ?? []) {
      // Never walk our own backups — they are meant to stay HEIC.
      if (o.Key && !o.Key.startsWith(BACKUP_PREFIX)) keys.push(o.Key);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function detect(key: string): Promise<string | null> {
  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: key, Range: 'bytes=0-31' }),
    );
    return heifBrand(await streamToBuffer(res.Body));
  } catch {
    return null;
  }
}

async function backupExists(key: string): Promise<boolean> {
  try {
    await s3.send(
      new HeadObjectCommand({ Bucket: BUCKET, Key: BACKUP_PREFIX + key }),
    );
    return true;
  } catch {
    return false;
  }
}

async function convertOne(key: string): Promise<{ before: number; after: number }> {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const input = await streamToBuffer(res.Body);

  // sharp can read HEIC metadata even though it cannot decode the pixels, so
  // EXIF orientation survives the pure-JS decode, which drops it.
  let orientation = 1;
  try {
    orientation = (await sharp(input).metadata()).orientation ?? 1;
  } catch {
    /* metadata is a nicety; a failure here must not block the conversion */
  }

  const decoded = Buffer.from(
    await heicConvert({ buffer: input, format: 'JPEG', quality: 0.9 }),
  );

  let pipeline = sharp(decoded, { failOn: 'none' });
  if (orientation > 1) pipeline = pipeline.withMetadata({ orientation }).rotate();
  const output = await pipeline.jpeg({ quality: 85, mozjpeg: true }).toBuffer();

  // Prove the result decodes before anything is overwritten.
  const check = await sharp(output).metadata();
  if (check.format !== 'jpeg' || !check.width) {
    throw new Error('converted buffer did not verify as JPEG');
  }

  // Preserve the original once, then replace the live object under its own key.
  if (!(await backupExists(key))) {
    await s3.send(
      new CopyObjectCommand({
        Bucket: BUCKET,
        CopySource: `${BUCKET}/${key}`,
        Key: BACKUP_PREFIX + key,
        ContentType: 'image/heic',
        MetadataDirective: 'REPLACE',
      }),
    );
  }

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: output,
      ContentType: 'image/jpeg',
      CacheControl: res.CacheControl,
    }),
  );

  return { before: input.length, after: output.length };
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

async function main() {
  const args = parseArgs();

  for (const [name, val] of Object.entries({
    R2_ENDPOINT: process.env.R2_ENDPOINT,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME: BUCKET,
  })) {
    if (!val) {
      console.error(`Missing ${name} in the environment.`);
      process.exit(1);
    }
  }

  console.log(
    `Scanning bucket "${BUCKET}"${args.prefix ? ` under "${args.prefix}"` : ''} …`,
  );
  const keys = await listAllKeys(args.prefix);
  console.log(`  ${keys.length} objects to inspect`);

  const found: string[] = [];
  let scanned = 0;
  await pool(keys, 12, async (key) => {
    const brand = await detect(key);
    scanned++;
    if (brand) found.push(key);
    if (scanned % 200 === 0) {
      console.log(`  scanned ${scanned}/${keys.length} — ${found.length} HEIC so far`);
    }
  });

  found.sort();
  const targets = args.limit > 0 ? found.slice(0, args.limit) : found;

  console.log(`\n${found.length} HEIC object(s) found.`);
  if (found.length === 0) return;

  if (!args.apply) {
    for (const k of targets) console.log(`  ${k}`);
    if (targets.length < found.length) {
      console.log(`  … and ${found.length - targets.length} more`);
    }
    console.log(
      `\nDry run — nothing written. Re-run with --apply to convert${
        args.limit > 0 ? ` (limited to ${targets.length})` : ''
      }.`,
    );
    return;
  }

  console.log(`Converting ${targets.length} object(s) …\n`);
  let ok = 0;
  let failed = 0;
  let bytesBefore = 0;
  let bytesAfter = 0;

  await pool(targets, args.concurrency, async (key) => {
    try {
      const { before, after } = await convertOne(key);
      bytesBefore += before;
      bytesAfter += after;
      ok++;
      console.log(`  ✓ ${key}  ${before} → ${after} bytes`);
    } catch (err: any) {
      failed++;
      console.error(`  ✗ ${key}  ${err.message}`);
    }
  });

  console.log(
    `\nDone. ${ok} converted, ${failed} failed. ` +
      `${(bytesBefore / 1048576).toFixed(1)}MB → ${(bytesAfter / 1048576).toFixed(1)}MB. ` +
      `Originals kept under ${BACKUP_PREFIX}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
