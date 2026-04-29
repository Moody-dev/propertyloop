/**
 * One-shot DB sweep: replace the R2 S3-endpoint host on every stored
 * media URL with the public r2.dev (or custom) host.
 *
 * The S3 endpoint
 *   https://<account>.r2.cloudflarestorage.com/<bucket>/<key>
 * always requires a signed AWS request, so opening it from a browser
 * returns "Authorization: InvalidArgument". The public bucket URL
 *   https://pub-<id>.r2.dev/<key>
 * (or any custom domain bound to the bucket) serves the same key
 * unauthenticated.
 *
 * Usage:
 *   npx ts-node scripts/rewrite-r2-urls.ts                 # dry-run (default)
 *   npx ts-node scripts/rewrite-r2-urls.ts --confirm       # execute
 *
 * Optional env overrides:
 *   R2_OLD_PREFIX   Defaults to https://<account>.r2.cloudflarestorage.com/<bucket>
 *   R2_PUBLIC_URL   The public host the URLs should be rewritten to
 *
 * Tables / columns covered:
 *   - User.avatarUrl
 *   - AgentProfile (no media columns — only via User cascade)
 *   - VendorProfile.bannerImage, VendorProfile.portfolioImages[]
 *   - Listing.coverImage, Listing.images[], Listing.videoUrl
 *   - ListingDocument.url
 *   - VendorJob.attachments[], VendorJob.completionProofImages[]
 *
 * A JSON snapshot of every "before / after" change is written to
 * scripts/output/r2-rewrite-<timestamp>.json regardless of mode, so
 * you have an audit trail (and the data needed to manually undo a
 * specific change if anything looks off).
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const args = process.argv.slice(2);
const confirm = args.includes('--confirm');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not set');

// Default to the project's known account/bucket pair, but allow override.
const accountId =
  process.env.R2_ACCOUNT_ID ?? '158f3ccc89076c431c395d201cdc3d35';
const bucket = process.env.R2_BUCKET_NAME ?? 'propertyloop';
const OLD_PREFIX =
  process.env.R2_OLD_PREFIX ??
  `https://${accountId}.r2.cloudflarestorage.com/${bucket}`;
const NEW_PREFIX = (
  process.env.R2_PUBLIC_URL ?? 'https://pub-c898594ed0304afe82dc69a1e671d46b.r2.dev'
).replace(/\/+$/, '');

if (OLD_PREFIX === NEW_PREFIX) {
  console.error(
    `✗ Old and new prefixes are identical (${OLD_PREFIX}). Nothing to do.`,
  );
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter } as any);

const swap = (s: string | null | undefined): string | null | undefined =>
  s && s.startsWith(OLD_PREFIX) ? NEW_PREFIX + s.slice(OLD_PREFIX.length) : s;

type Change = {
  table: string;
  column: string;
  rowId: string;
  before: string | string[] | null | undefined;
  after: string | string[] | null | undefined;
};

async function main() {
  console.log('═══ R2 URL rewrite ═══');
  console.log(`Old prefix: ${OLD_PREFIX}`);
  console.log(`New prefix: ${NEW_PREFIX}`);
  console.log(`Mode:       ${confirm ? '🔥 EXECUTE' : 'DRY-RUN'}\n`);

  const changes: Change[] = [];
  const counts: Record<string, number> = {};
  const bump = (key: string) => (counts[key] = (counts[key] ?? 0) + 1);

  // ─── User.avatarUrl ────────────────────────────────────────────────────
  const users = await prisma.user.findMany({
    where: { avatarUrl: { startsWith: OLD_PREFIX } },
    select: { id: true, avatarUrl: true },
  });
  for (const u of users) {
    const after = swap(u.avatarUrl);
    if (after === u.avatarUrl) continue;
    changes.push({
      table: 'User',
      column: 'avatarUrl',
      rowId: u.id,
      before: u.avatarUrl,
      after,
    });
    bump('User.avatarUrl');
    if (confirm) {
      await prisma.user.update({
        where: { id: u.id },
        data: { avatarUrl: after ?? null },
      });
    }
  }

  // ─── VendorProfile.bannerImage + portfolioImages[] ────────────────────
  const vps = await prisma.vendorProfile.findMany({
    select: {
      id: true,
      bannerImage: true,
      portfolioImages: true,
    },
  });
  for (const v of vps) {
    const newBanner = swap(v.bannerImage);
    const newPortfolio = v.portfolioImages.map((u) => swap(u) ?? u);
    const bannerChanged = newBanner !== v.bannerImage;
    const portfolioChanged = newPortfolio.some(
      (u, i) => u !== v.portfolioImages[i],
    );
    if (!bannerChanged && !portfolioChanged) continue;
    if (bannerChanged) {
      changes.push({
        table: 'VendorProfile',
        column: 'bannerImage',
        rowId: v.id,
        before: v.bannerImage,
        after: newBanner,
      });
      bump('VendorProfile.bannerImage');
    }
    if (portfolioChanged) {
      changes.push({
        table: 'VendorProfile',
        column: 'portfolioImages',
        rowId: v.id,
        before: v.portfolioImages,
        after: newPortfolio,
      });
      bump('VendorProfile.portfolioImages');
    }
    if (confirm) {
      await prisma.vendorProfile.update({
        where: { id: v.id },
        data: {
          ...(bannerChanged && { bannerImage: newBanner ?? null }),
          ...(portfolioChanged && { portfolioImages: newPortfolio }),
        },
      });
    }
  }

  // ─── Listing.coverImage + images[] + videoUrl ─────────────────────────
  const listings = await prisma.listing.findMany({
    select: {
      id: true,
      coverImage: true,
      images: true,
      videoUrl: true,
    },
  });
  for (const l of listings) {
    const newCover = swap(l.coverImage);
    const newImages = l.images.map((u) => swap(u) ?? u);
    const newVideo = swap(l.videoUrl);
    const coverChanged = newCover !== l.coverImage;
    const imagesChanged = newImages.some((u, i) => u !== l.images[i]);
    const videoChanged = newVideo !== l.videoUrl;
    if (!coverChanged && !imagesChanged && !videoChanged) continue;
    if (coverChanged) {
      changes.push({
        table: 'Listing',
        column: 'coverImage',
        rowId: l.id,
        before: l.coverImage,
        after: newCover,
      });
      bump('Listing.coverImage');
    }
    if (imagesChanged) {
      changes.push({
        table: 'Listing',
        column: 'images',
        rowId: l.id,
        before: l.images,
        after: newImages,
      });
      bump('Listing.images');
    }
    if (videoChanged) {
      changes.push({
        table: 'Listing',
        column: 'videoUrl',
        rowId: l.id,
        before: l.videoUrl,
        after: newVideo,
      });
      bump('Listing.videoUrl');
    }
    if (confirm) {
      await prisma.listing.update({
        where: { id: l.id },
        data: {
          ...(coverChanged && { coverImage: newCover ?? '' }),
          ...(imagesChanged && { images: newImages }),
          ...(videoChanged && { videoUrl: newVideo ?? null }),
        },
      });
    }
  }

  // ─── ListingDocument.url ──────────────────────────────────────────────
  const docs = await prisma.listingDocument.findMany({
    where: { url: { startsWith: OLD_PREFIX } },
    select: { id: true, url: true },
  });
  for (const d of docs) {
    const after = swap(d.url);
    if (after === d.url) continue;
    changes.push({
      table: 'ListingDocument',
      column: 'url',
      rowId: d.id,
      before: d.url,
      after,
    });
    bump('ListingDocument.url');
    if (confirm) {
      await prisma.listingDocument.update({
        where: { id: d.id },
        data: { url: after ?? null },
      });
    }
  }

  // ─── VendorJob.attachments[] + completionProofImages[] ────────────────
  const jobs = await prisma.vendorJob.findMany({
    select: {
      id: true,
      attachments: true,
      completionProofImages: true,
    },
  });
  for (const j of jobs) {
    const newAttachments = j.attachments.map((u) => swap(u) ?? u);
    const newProofs = j.completionProofImages.map((u) => swap(u) ?? u);
    const attachmentsChanged = newAttachments.some(
      (u, i) => u !== j.attachments[i],
    );
    const proofsChanged = newProofs.some(
      (u, i) => u !== j.completionProofImages[i],
    );
    if (!attachmentsChanged && !proofsChanged) continue;
    if (attachmentsChanged) {
      changes.push({
        table: 'VendorJob',
        column: 'attachments',
        rowId: j.id,
        before: j.attachments,
        after: newAttachments,
      });
      bump('VendorJob.attachments');
    }
    if (proofsChanged) {
      changes.push({
        table: 'VendorJob',
        column: 'completionProofImages',
        rowId: j.id,
        before: j.completionProofImages,
        after: newProofs,
      });
      bump('VendorJob.completionProofImages');
    }
    if (confirm) {
      await prisma.vendorJob.update({
        where: { id: j.id },
        data: {
          ...(attachmentsChanged && { attachments: newAttachments }),
          ...(proofsChanged && { completionProofImages: newProofs }),
        },
      });
    }
  }

  // ─── Snapshot ─────────────────────────────────────────────────────────
  const outDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotPath = path.join(outDir, `r2-rewrite-${stamp}.json`);
  fs.writeFileSync(
    snapshotPath,
    JSON.stringify(
      {
        executedAt: new Date().toISOString(),
        mode: confirm ? 'execute' : 'dry-run',
        oldPrefix: OLD_PREFIX,
        newPrefix: NEW_PREFIX,
        counts,
        changes,
      },
      null,
      2,
    ),
    'utf8',
  );

  // ─── Report ───────────────────────────────────────────────────────────
  console.log('Rewrites by column:');
  if (Object.keys(counts).length === 0) {
    console.log('  (none — nothing matched the old prefix)');
  } else {
    for (const [k, n] of Object.entries(counts)) {
      console.log(`  ${k.padEnd(36)}: ${n}`);
    }
  }
  console.log(`\nTotal changes: ${changes.length}`);
  console.log(`Snapshot:      ${snapshotPath}\n`);

  if (!confirm && changes.length > 0) {
    console.log(
      '▶  Dry-run only — no DB writes happened. Re-run with --confirm to apply.',
    );
  }
}

main()
  .catch((err) => {
    console.error('Rewrite failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
