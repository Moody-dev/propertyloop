/**
 * Publish paid brand ads to PRODUCTION.
 *
 * For each entry in PLACEMENTS, uploads the creative to R2 (under brand-ads/)
 * and inserts an ACTIVE BrandAd row so it starts serving immediately at
 * GET /api/ads/serve?placement=...
 *
 * ⚠  This writes to the LIVE database and LIVE storage. It runs as a DRY RUN by
 *    default: it validates the config, uploads nothing, inserts nothing, and
 *    only prints the plan. Re-run with --confirm to actually publish.
 *
 *    npx ts-node scripts/publish-brand-ad.ts            # preview (safe)
 *    npx ts-node scripts/publish-brand-ad.ts --confirm  # publish for real
 *
 * Fill in the AD + PLACEMENTS blocks below with the real client details first —
 * the script refuses to run while any REPLACE_ME placeholder remains.
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, AdPlacement, AdStatus, Role } from '../generated/prisma/client';

// Mirror of AdsService.AD_WEEKLY_RATES (naira) — the amount is always computed
// server-side from placement × weeks, never typed by hand.
const AD_WEEKLY_RATES = {
  SPLASH: 150_000,
  HOME_BANNER: 100_000,
  SEARCH_INLINE: 60_000,
  HOME_FEED: 50_000,
} as const;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
};

// ─── Fill this in ─────────────────────────────────────────────────────────────
// Shared advertiser + creative copy — identical across every placement for this
// client. The per-slot image is chosen in PLACEMENTS below.
const AD = {
  // Owner record the schema requires — the advertiser never logs in. Leave
  // blank to auto-attach to your oldest ADMIN account, or set a specific email.
  ownerEmail: '',

  // The advertiser
  brandName: 'Terryrock Technical Company Limited', // 2–80 chars
  contactEmail: 'info@terrytechnical.com', //          kept private
  contactPhone: '', //                                 optional

  // The copy (same across all placements)
  headline: 'Your commercial thermal insulation allies', // 4–90 chars
  body: '', //                                              optional, ≤200 chars
  ctaLabel: 'Learn more', //                                ≤24 chars
  ctaUrl: 'https://www.terryrockltd.com', //                where a tap/click goes

  // Run window (applies to every placement)
  weeks: 4, //     1–12  (≈ one month)
  priority: 0, //  higher = shown first when a slot has several live ads
};

const ASSETS_DIR = 'C:\\Users\\HP\\Desktop\\propertyloop\\frontend\\src\\assets';

// One creative per placement. Images are matched to each slot's shape:
//  • SPLASH is a portrait 4:5 interstitial → the branded cover (logo + tagline)
//    fits it with almost no cropping and makes the strongest full-screen hero.
//  • HOME_BANNER is a wide strip under a dark text scrim → the silver
//    insulated-pipe imagery is the clearest "thermal insulation" statement and
//    reads premium behind the overlay (its page titles crop away).
//  • HOME_FEED is a small 16/10 card → the airiest composition (a few big
//    circular project photos on white) stays legible at thumbnail size.
const PLACEMENTS: {
  placement: keyof typeof AD_WEEKLY_RATES;
  imagePath: string;
}[] = [
  { placement: 'SPLASH', imagePath: path.join(ASSETS_DIR, '1_hero_banner.jpg') },
  { placement: 'HOME_BANNER', imagePath: path.join(ASSETS_DIR, '3_services.jpg') },
  { placement: 'HOME_FEED', imagePath: path.join(ASSETS_DIR, '2_about.jpg') },
];
// ────────────────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Ensure a click target actually leaves our site: prepend https:// if the
 *  advertiser gave a bare host like "www.example.com". A schemeless href is
 *  treated as a relative path by the browser and fails to open on mobile. */
function normalizeUrl(u: string): string {
  const t = u.trim();
  if (!t) return t;
  return /^https?:\/\//i.test(t) ? t : `https://${t.replace(/^\/+/, '')}`;
}

function validate(): string[] {
  const errs: string[] = [];
  const strings = [
    AD.ownerEmail,
    AD.brandName,
    AD.contactEmail,
    AD.contactPhone,
    AD.headline,
    AD.body,
    AD.ctaLabel,
    AD.ctaUrl,
  ];
  if (strings.some((s) => /REPLACE_ME/i.test(s))) {
    errs.push('Config still has REPLACE_ME placeholders — fill in the AD block.');
  }
  if (AD.brandName.trim().length < 2 || AD.brandName.length > 80)
    errs.push('brandName must be 2–80 chars');
  if (AD.ownerEmail && !EMAIL_RE.test(AD.ownerEmail))
    errs.push('ownerEmail is set but invalid (leave blank to auto-use your admin)');
  if (!EMAIL_RE.test(AD.contactEmail)) errs.push('contactEmail is not a valid email');
  if (AD.headline.trim().length < 4 || AD.headline.length > 90)
    errs.push('headline must be 4–90 chars');
  if (AD.body && AD.body.length > 200) errs.push('body must be ≤200 chars');
  if (AD.ctaLabel.length > 24) errs.push('ctaLabel must be ≤24 chars');
  if (!/^https?:\/\/.+/i.test(AD.ctaUrl)) errs.push('ctaUrl must be an http(s) URL');
  if (!Number.isInteger(AD.weeks) || AD.weeks < 1 || AD.weeks > 12)
    errs.push('weeks must be an integer 1–12');

  if (PLACEMENTS.length === 0) errs.push('PLACEMENTS is empty — nothing to publish');
  const seen = new Set<string>();
  PLACEMENTS.forEach((p, i) => {
    if (!(p.placement in AD_WEEKLY_RATES))
      errs.push(`PLACEMENTS[${i}]: placement "${p.placement}" is not valid`);
    if (seen.has(p.placement))
      errs.push(`PLACEMENTS[${i}]: placement "${p.placement}" is listed more than once`);
    seen.add(p.placement);
    if (!fs.existsSync(p.imagePath))
      errs.push(`PLACEMENTS[${i}]: image not found at ${p.imagePath}`);
  });
  return errs;
}

/** Everything needed to publish one placement, resolved from config. */
type PlanItem = {
  placement: keyof typeof AD_WEEKLY_RATES;
  imagePath: string;
  buffer: Buffer;
  contentType: string;
  weeklyRate: number;
  amountNaira: number;
  key: string;
  imageUrl: string;
};

async function main() {
  const confirm = process.argv.includes('--confirm');

  AD.ctaUrl = normalizeUrl(AD.ctaUrl);
  const errs = validate();
  if (errs.length) {
    console.error('✗ Config invalid:\n' + errs.map((e) => '  - ' + e).join('\n'));
    process.exit(1);
  }

  // All placements share one run window so the campaign starts together.
  const startAt = new Date();
  const endAt = new Date(startAt.getTime() + AD.weeks * WEEK_MS);
  const publicBase = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');

  const items: PlanItem[] = PLACEMENTS.map((p) => {
    const buffer = fs.readFileSync(p.imagePath);
    const ext = (path.extname(p.imagePath) || '.jpg').toLowerCase();
    const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream';
    const key = `brand-ads/${Date.now()}-${p.placement.toLowerCase()}-${crypto
      .randomBytes(4)
      .toString('hex')}${ext}`;
    const weeklyRate = AD_WEEKLY_RATES[p.placement];
    return {
      placement: p.placement,
      imagePath: p.imagePath,
      buffer,
      contentType,
      weeklyRate,
      amountNaira: weeklyRate * AD.weeks,
      key,
      imageUrl: `${publicBase}/${key}`,
    };
  });

  const total = items.reduce((sum, it) => sum + it.amountNaira, 0);

  console.log('Plan:');
  console.log(`  owner:      ${AD.ownerEmail || '(auto — oldest ADMIN account)'}`);
  console.log(`  brand:      ${AD.brandName}`);
  console.log(`  headline:   ${AD.headline}`);
  console.log(`  ctaUrl:     ${AD.ctaUrl}`);
  console.log(`  run:        ${AD.weeks} week(s)  ${startAt.toISOString()} → ${endAt.toISOString()}`);
  console.log(`  placements: ${items.length}`);
  for (const it of items) {
    console.log('');
    console.log(`  • ${it.placement}  (₦${it.weeklyRate.toLocaleString()}/wk → ₦${it.amountNaira.toLocaleString()})`);
    console.log(`      creative:   ${path.basename(it.imagePath)}  (${(it.buffer.length / 1024).toFixed(0)} KB, ${it.contentType})`);
    console.log(`      → R2 key:   ${it.key}`);
    console.log(`      → URL:      ${it.imageUrl}`);
  }
  console.log('');
  console.log(`  TOTAL:      ₦${total.toLocaleString()}  (server-computed, not charged by this script)`);

  if (!confirm) {
    console.log('\nDRY RUN — nothing uploaded or written. Re-run with --confirm to publish.');
    return;
  }

  // ── Real writes to LIVE storage + DB below this line ──
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  if (!publicBase) throw new Error('R2_PUBLIC_URL is not set');

  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter } as any);

  try {
    // Resolve the owner once, before any upload — a bad owner should fail the
    // whole run without orphaning objects in R2.
    const owner = AD.ownerEmail
      ? await prisma.user.findUnique({
          where: { email: AD.ownerEmail.trim().toLowerCase() },
        })
      : await prisma.user.findFirst({
          where: { role: Role.ADMIN },
          orderBy: { createdAt: 'asc' },
        });
    if (!owner) {
      throw new Error(
        AD.ownerEmail
          ? `No user found with email ${AD.ownerEmail}.`
          : 'No ADMIN user found to own the ads. Set AD.ownerEmail to an existing account.',
      );
    }
    console.log(`\nOwner: ${owner.email} (${owner.id})`);

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

    const apiBase = (process.env.PUBLIC_API_URL || '').replace(/\/$/, '');

    for (const it of items) {
      console.log(`\n── ${it.placement} ──`);
      console.log('Uploading creative to R2…');
      await s3.send(
        new PutObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME!,
          Key: it.key,
          Body: it.buffer,
          ContentType: it.contentType,
        }),
      );
      console.log(`✓ Uploaded → ${it.imageUrl}`);

      console.log('Inserting BrandAd row (status ACTIVE)…');
      const ad = await prisma.brandAd.create({
        data: {
          ownerUserId: owner.id,
          brandName: AD.brandName.trim(),
          contactEmail: AD.contactEmail.trim(),
          contactPhone: AD.contactPhone.trim() || null,
          imageUrl: it.imageUrl,
          headline: AD.headline.trim(),
          body: AD.body.trim() || null,
          ctaLabel: AD.ctaLabel.trim() || 'Learn more',
          ctaUrl: AD.ctaUrl.trim(),
          placement: it.placement as AdPlacement,
          status: AdStatus.ACTIVE,
          priority: AD.priority,
          startAt,
          endAt,
          weeks: AD.weeks,
          amountNaira: it.amountNaira,
          paidAt: new Date(),
        },
      });
      console.log(`✓ Published. BrandAd id: ${ad.id}`);
      console.log(`  Verify: GET ${apiBase}/api/ads/serve?placement=${it.placement}`);
    }

    console.log(`\n✓ All ${items.length} placements published for ${AD.brandName}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
