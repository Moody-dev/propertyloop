/**
 * HEIC → JPEG conversion.
 *
 * iPhones with "High Efficiency" enabled produce HEIC, and browsers other than
 * Safari cannot decode it. Left as-is the bytes reach the browser labelled
 * image/jpeg, the <img> load fails, and the UI falls back to the PropertyLoop
 * banner — which is why listings were showing branding instead of photos.
 *
 * Deliberately plain functions rather than an injectable: B2Service needs this
 * during upload, and a Nest provider there would create a cycle between the
 * storage and media modules.
 *
 * sharp cannot do the decode on its own — its prebuilt binary ships libheif
 * without the HEVC codec (patent licensing), so it reads HEIC metadata but
 * throws on the pixels. heic-convert decodes in pure JS; sharp re-encodes so
 * quality and orientation match every other image we store.
 */
import sharp = require('sharp');

// heic-convert ships no type declarations and this project has esModuleInterop
// off, so it comes in through require with a hand-written signature.
const heicConvert = require('heic-convert') as (opts: {
  buffer: Buffer;
  format: 'JPEG' | 'PNG';
  quality?: number;
}) => Promise<ArrayBuffer>;

// ISO-BMFF brands meaning "HEIC/HEIF still image". `avif` is deliberately
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

/**
 * Leading bytes needed to identify the container. isHeicBuffer reads the first
 * twelve; callers fetching over the network round up so one Range request is
 * enough to sniff any object.
 */
export const HEIC_SNIFF_BYTES = 32;

/**
 * Detects HEIC from the bytes rather than the filename or mime type, because
 * both lie: iOS browsers routinely present a HEIC as "photo.jpg" with
 * Content-Type image/jpeg, which is exactly how these got stored.
 */
export function isHeicBuffer(buf?: Buffer | null): boolean {
  if (!buf || buf.length < 12) return false;
  if (buf.toString('latin1', 4, 8) !== 'ftyp') return false;
  return HEIF_BRANDS.has(buf.toString('latin1', 8, 12));
}

/** Decodes HEIC and re-encodes as JPEG. Throws if the result isn't valid. */
export async function heicBufferToJpeg(buf: Buffer): Promise<Buffer> {
  // sharp can read HEIC metadata even though it cannot decode the pixels, so
  // EXIF orientation survives the pure-JS decode, which drops it.
  let orientation = 1;
  try {
    orientation = (await sharp(buf).metadata()).orientation ?? 1;
  } catch {
    /* metadata is a nicety; a failure here must not block the conversion */
  }

  const decoded = Buffer.from(
    await heicConvert({ buffer: buf, format: 'JPEG', quality: 0.9 }),
  );

  let pipeline = sharp(decoded, { failOn: 'none' });
  if (orientation > 1) pipeline = pipeline.withMetadata({ orientation }).rotate();
  const out = await pipeline.jpeg({ quality: 85, mozjpeg: true }).toBuffer();

  const check = await sharp(out).metadata();
  if (check.format !== 'jpeg' || !check.width) {
    throw new Error('HEIC conversion did not produce a valid JPEG');
  }
  return out;
}

/** Swaps a .heic/.heif extension for .jpg, appending one if there was none. */
export function jpegFilename(filename: string): string {
  if (/\.(heic|heif)$/i.test(filename)) return filename.replace(/\.[^.]+$/, '.jpg');
  if (/\.jpe?g$/i.test(filename)) return filename;
  return `${filename.replace(/\.[^.]+$/, '')}.jpg`;
}
