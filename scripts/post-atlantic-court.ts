/**
 * Post Atlantic Court Estate (Prime Ajah, Lagos) as PropertyLoop stock.
 *
 * One product — 8 identical semi-detached duplexes at one price — so one
 * listing with units set to 8, unlike Newtown Estate where three different
 * house types needed three.
 *
 * Every figure here is read off the flyer. Nothing was inferred: the flyer
 * does not state a bathroom count, so baths stays 0 and the website hides the
 * row rather than showing a number nobody supplied.
 *
 * ⚠  Writes to the LIVE database and LIVE storage. DRY RUN by default.
 *
 *    npx ts-node scripts/post-atlantic-court.ts --image=/path/to/flyer.png
 *    npx ts-node scripts/post-atlantic-court.ts --image=/path/to/flyer.png --confirm
 *
 * Writes through Prisma, not StaffListingsService, so the automatic new-stock
 * announcement does not fire. Announce it deliberately, if at all.
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PrismaClient,
  Chapter,
  ListingOwnership,
  ListingStatus,
  ListingType,
} from '../generated/prisma/client';

/** The account house stock is listed under, and the staff profile credited. */
const OWNER_USER_ID = 'cmtz9y96f0004zcuaoqxdtbva'; // ola@propertyloop.ng
const SOURCED_BY_STAFF_ID = 'cmtz9y9aw0005zcuaxsswg8ed';

const TITLE =
  'Atlantic Court Estate — 4 Bedroom Semi-Detached Duplex with BQ, Prime Ajah';
const PRICE_NAIRA = 220_000_000;
/** "8 exclusive" units on the flyer. */
const UNITS = 8;
const BEDS = 4;
/** The flyer gives no bathroom count, and a listing must not invent one. */
const BATHS = 0;

const LOCATION = 'Ajah, Lagos';
const ADDRESS = 'Atlantic Court Estate, Prime Ajah, Lagos';
const CHAPTER = Chapter.LAGOS;
/** The website's Houses filter maps to this exact string. */
const PROPERTY_TYPE = 'House';

const FEATURES = [
  '4 Bedrooms',
  'BQ',
  'Private Parking',
  'Access Road',
  'Contemporary Design',
  'Gated and Secured Estate',
];

const DESCRIPTION = [
  'Now selling at Atlantic Court Estate, Prime Ajah, Lagos: 8 exclusive 4-bedroom semi-detached duplexes with BQ.',
  '',
  'FEATURES',
  '4 bedrooms · BQ · private parking · access road · contemporary design · gated and secured estate.',
  '',
  'NEIGHBOURHOOD',
  'Near General Paint bus stop, Abraham Adesanya, Lekki Gardens Phase 4 and 5, Lagos Business School, Novare Mall / Shoprite and Ajah.',
  '',
  'Developed by Oakwood Homes & Construct Ltd.',
  '',
  'Book an inspection through PropertyLoop. Office: km36 Lekki-Epe Expressway, 3rd floor, Lekki Swiss Mall, opposite Mayfair Gardens, Ibeju-Lekki, Lagos.',
].join('\n');

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

/** "₦220,000,000" — the website renders this string rather than reformatting. */
const priceLabel = (naira: number) =>
  `₦${Math.round(naira).toLocaleString('en-NG')}`;

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes('--confirm');
  const imagePath = args
    .find((a) => a.startsWith('--image='))
    ?.split('=')
    .slice(1)
    .join('=');

  if (!imagePath) throw new Error('Pass --image=/path/to/flyer.png');
  if (!fs.existsSync(imagePath)) throw new Error(`No such image: ${imagePath}`);
  const ext = path.extname(imagePath).toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  if (!contentType) throw new Error(`Unsupported image type: ${ext}`);
  const buffer = fs.readFileSync(imagePath);

  const publicBase = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');
  const key = `listings/${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
  const imageUrl = `${publicBase}/${key}`;

  console.log('Atlantic Court Estate — PropertyLoop stock\n');
  console.log(`  ${TITLE}`);
  console.log(`  ${priceLabel(PRICE_NAIRA)} · ${BEDS} bed · ${UNITS} units`);
  console.log(`  ${LOCATION}  ·  ${PROPERTY_TYPE}  ·  chapter ${CHAPTER}`);
  console.log(
    `  image: ${path.basename(imagePath)} (${(buffer.length / 1024).toFixed(0)} KB)`,
  );
  console.log(`  cover → ${imageUrl}`);
  if (BATHS === 0) {
    console.log('  note: no bathroom count on the flyer — left unset');
  }

  if (!confirm) {
    console.log('\nDry run. Nothing uploaded, nothing written. Re-run with --confirm.');
    return;
  }

  if (!publicBase) throw new Error('R2_PUBLIC_URL is not set');
  for (const v of [
    'R2_ENDPOINT',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET_NAME',
  ]) {
    if (!process.env[v]) throw new Error(`${v} is not set`);
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: (process.env.DIRECT_URL || process.env.DATABASE_URL)!,
    }),
  } as any);

  try {
    const owner = await prisma.user.findUnique({
      where: { id: OWNER_USER_ID },
      select: { id: true, email: true, isActive: true },
    });
    if (!owner) throw new Error(`Owner account ${OWNER_USER_ID} not found`);
    // The public listing query hides listings whose owner is inactive.
    if (!owner.isActive) throw new Error(`Owner ${owner.email} is not active`);
    console.log(`\nOwner: ${owner.email}`);

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

    console.log('Uploading the flyer to R2…');
    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );
    console.log(`✓ Uploaded → ${imageUrl}`);

    const slug = await uniqueSlug(prisma, TITLE);
    const listing = await prisma.listing.create({
      data: {
        agentId: owner.id,
        sourcedByStaffId: SOURCED_BY_STAFF_ID,
        ownership: ListingOwnership.HOUSE,
        chapter: CHAPTER,
        title: TITLE,
        slug,
        type: ListingType.SALE,
        propertyType: PROPERTY_TYPE,
        priceNaira: BigInt(PRICE_NAIRA),
        priceLabel: priceLabel(PRICE_NAIRA),
        address: ADDRESS,
        location: LOCATION,
        beds: BEDS,
        baths: BATHS,
        sqft: '',
        description: DESCRIPTION,
        features: FEATURES,
        coverImage: imageUrl,
        images: [imageUrl],
        status: ListingStatus.ACTIVE,
        publishedAt: new Date(),
        units: UNITS,
      },
      select: { id: true, title: true },
    });

    console.log(`\n✓ ${listing.title}`);
    console.log(`    id ${listing.id}  ·  /property/${listing.id}`);
    console.log('\nDone. Live on the website, the app, and under PL stock.');
  } finally {
    await prisma.$disconnect();
  }
}

/** Listing.slug is unique, and a second "Atlantic Court …" must still save. */
async function uniqueSlug(prisma: any, title: string): Promise<string> {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'property';
  for (let n = 0; n < 50; n += 1) {
    const slug = n === 0 ? base : `${base}-${n + 1}`;
    const taken = await prisma.listing.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!taken) return slug;
  }
  return `${base}-${Date.now()}`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
