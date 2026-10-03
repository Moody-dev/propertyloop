/**
 * Post Newtown Estate (Mowe Ofada) as PropertyLoop stock.
 *
 * Three bungalow types at three prices, so three listings: a partner brings a
 * buyer to a specific product, and the commission figure shown is the one for
 * that product rather than for the cheapest.
 *
 * ⚠  This writes to the LIVE database and LIVE storage. It is a DRY RUN by
 *    default: it validates, uploads nothing, inserts nothing, prints the plan.
 *
 *    npx ts-node scripts/post-newtown-estate.ts --image=/path/to/flyer.png
 *    npx ts-node scripts/post-newtown-estate.ts --image=/path/to/flyer.png --confirm
 *
 * Note it writes through Prisma, not StaffListingsService, so the automatic
 * new-stock announcement does NOT fire. That is deliberate: three publishes
 * would send every agent three emails about one estate. Announce it once, by
 * hand, if it should be announced at all.
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

/**
 * The account house stock is listed under, and the staff profile credited with
 * sourcing it — the same pair as the existing PropertyLoop stock.
 */
const OWNER_USER_ID = 'cmtz9y96f0004zcuaoqxdtbva'; // ola@propertyloop.ng
const SOURCED_BY_STAFF_ID = 'cmtz9y9aw0005zcuaxsswg8ed';

/**
 * Ogun is not a chapter — the enum is LAGOS | OSUN — and chapter records which
 * chapter sourced the mandate, not where the property sits. Mowe Ofada is the
 * Lagos chapter's corridor, off the Lagos-Ibadan Expressway.
 */
const CHAPTER = Chapter.LAGOS;

/**
 * "House", not "Terrace": the website's Houses filter maps to this exact
 * string, and a value outside that map is invisible to a filtered search. The
 * precise type is in the title and the description.
 */
const PROPERTY_TYPE = 'House';

const LOCATION = 'Mowe Ofada, Ogun';
const ADDRESS =
  'Newtown Estate, Mowe Ofada, Ogun State — off Lagos-Ibadan Expressway';

const ESTATE_FEATURES = [
  "Governor's Consent",
  'Solar Powered Streetlights',
  '24/7 Security & Access Control',
  'Paved Road Network',
  'Dedicated Transformer',
  'Modern Sport Arena',
  'Mini Mart & Farmers Market',
  'Estate Car Wash',
  'Gatehouse',
  'Perimeter Fencing',
  'Automated Gate',
  'Good Drainage System',
  'All Rooms Ensuite',
  'Fitted Wardrobes',
  'Modern Kitchen',
  'Private Compound',
  'Ample Parking',
  'Payment Plan Available',
];

function description(unit: string): string {
  return [
    `${unit} at Newtown Estate, Mowe Ofada — an already developed estate with instant allocation, built in red brick for longevity, beauty and strength.`,
    '',
    'Title: Governor’s Consent. Payment plan available.',
    '',
    'ESTATE FEATURES',
    'Solar powered streetlights · 24/7 security and access control · paved road network · dedicated transformer · modern sport arena · mini mart and farmers market · estate car wash · gatehouse · beautifully planned environment.',
    '',
    'HOUSE FEATURES',
    'All rooms ensuite · spacious living area · fitted wardrobes · modern kitchen · private compound · ample parking.',
    '',
    'LOCATION',
    'Off the Lagos-Ibadan Expressway, close to Omu Arogun Junction and the MFM Mowe Region. Nearby: Mowe Main Market, MedicPlus Hospital, Oba Makinde Onigbein and the International Breweries area.',
  ].join('\n');
}

const UNITS: {
  label: string;
  title: string;
  priceNaira: number;
  beds: number;
  baths: number;
}[] = [
  {
    label: '2-Bedroom Terrace Bungalow',
    title:
      'Newtown Estate Red Brick 2-Bedroom Terrace Bungalow, Mowe Ofada',
    priceNaira: 50_000_000,
    beds: 2,
    baths: 2,
  },
  {
    label: '3-Bedroom Semi-Detached Bungalow',
    title:
      'Newtown Estate Red Brick 3-Bedroom Semi-Detached Bungalow, Mowe Ofada',
    priceNaira: 55_000_000,
    beds: 3,
    baths: 3,
  },
  {
    label: '3-Bedroom Fully Detached Bungalow',
    title:
      'Newtown Estate Red Brick 3-Bedroom Fully Detached Bungalow, Mowe Ofada',
    priceNaira: 60_000_000,
    beds: 3,
    baths: 3,
  },
];

/** "₦50,000,000" — the website renders this string rather than reformatting. */
const priceLabel = (naira: number) =>
  `₦${Math.round(naira).toLocaleString('en-NG')}`;

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes('--confirm');
  const imageArg = args.find((a) => a.startsWith('--image='));
  const imagePath = imageArg?.split('=').slice(1).join('=');

  if (!imagePath) {
    throw new Error(
      'Pass the estate image: --image=/path/to/flyer.png (it becomes the cover photo)',
    );
  }
  if (!fs.existsSync(imagePath)) {
    throw new Error(`No such image: ${imagePath}`);
  }
  const ext = path.extname(imagePath).toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  if (!contentType) {
    throw new Error(`Unsupported image type: ${ext}`);
  }
  const buffer = fs.readFileSync(imagePath);

  const publicBase = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');
  const key = `listings/${Date.now()}-${crypto
    .randomBytes(4)
    .toString('hex')}${ext}`;
  const imageUrl = `${publicBase}/${key}`;

  console.log('Newtown Estate — PropertyLoop stock\n');
  console.log(`Image:    ${path.basename(imagePath)} (${(buffer.length / 1024).toFixed(0)} KB, ${contentType})`);
  console.log(`Cover →   ${imageUrl}`);
  console.log(`Location: ${LOCATION}`);
  console.log(`Chapter:  ${CHAPTER}  ·  Type: ${PROPERTY_TYPE}  ·  Ownership: HOUSE`);
  console.log('\nListings to create (all ACTIVE, published now):');
  for (const u of UNITS) {
    console.log(`  • ${u.title}`);
    console.log(`      ${priceLabel(u.priceNaira)} · ${u.beds} bed · ${u.baths} bath`);
  }

  if (!confirm) {
    console.log(
      '\nDry run. Nothing uploaded, nothing written. Re-run with --confirm to publish.',
    );
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
    // The public listing query hides listings whose owner is inactive, so a
    // suspended owner would publish three listings nobody can see.
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

    console.log('Uploading the estate image to R2…');
    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );
    console.log(`✓ Uploaded → ${imageUrl}`);

    const now = new Date();
    for (const u of UNITS) {
      const slug = await uniqueSlug(prisma, u.title);
      const listing = await prisma.listing.create({
        data: {
          agentId: owner.id,
          sourcedByStaffId: SOURCED_BY_STAFF_ID,
          ownership: ListingOwnership.HOUSE,
          chapter: CHAPTER,
          title: u.title,
          slug,
          type: ListingType.SALE,
          propertyType: PROPERTY_TYPE,
          priceNaira: BigInt(u.priceNaira),
          priceLabel: priceLabel(u.priceNaira),
          address: ADDRESS,
          location: LOCATION,
          beds: u.beds,
          baths: u.baths,
          sqft: '',
          description: description(u.label),
          features: ESTATE_FEATURES,
          coverImage: imageUrl,
          images: [imageUrl],
          status: ListingStatus.ACTIVE,
          publishedAt: now,
          units: 1,
        },
        select: { id: true, slug: true, title: true },
      });
      console.log(`✓ ${listing.title}`);
      console.log(`    id ${listing.id}  ·  /property/${listing.id}`);
    }
    console.log('\nDone. Live on the website, the app, and under PL stock.');
  } finally {
    await prisma.$disconnect();
  }
}

/** Listing.slug is unique, and a second "Newtown Estate …" must still save. */
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
