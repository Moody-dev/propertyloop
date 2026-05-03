/**
 * One-off: hard-delete a user account AND every R2 object they own.
 *
 * Walks every relation that holds a media URL (avatar, banner, portfolio,
 * listing media, listing documents, vendor job attachments / proofs),
 * resolves the R2 key from each URL, deletes the object from the bucket,
 * then deletes the User row (cascades the DB).
 *
 * Usage:
 *   npx ts-node scripts/purge-user-and-cloud.ts --email=foo@bar.com           # dry-run
 *   npx ts-node scripts/purge-user-and-cloud.ts --email=foo@bar.com --confirm  # execute
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';

const args = process.argv.slice(2);
const emailArg = args.find((a) => a.startsWith('--email='));
if (!emailArg) {
  console.error('Usage: --email=foo@bar.com [--confirm]');
  process.exit(1);
}
const targetEmail = emailArg.split('=')[1].trim().toLowerCase();
const confirm = args.includes('--confirm');

// ─── R2 client (matches B2Service runtime config) ────────────────────────
const bucketName = process.env.R2_BUCKET_NAME!;
const endpoint = process.env.R2_ENDPOINT!;
const accessKeyId = process.env.R2_ACCESS_KEY_ID!;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY!;
const publicUrl = process.env.R2_PUBLIC_URL!;
if (!bucketName || !endpoint || !accessKeyId || !secretAccessKey) {
  console.error('Missing R2 env vars. Aborting.');
  process.exit(1);
}
const s3 = new S3Client({
  region: 'auto',
  endpoint,
  credentials: { accessKeyId, secretAccessKey },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
} as any);

/**
 * Resolve a stored URL to the R2 object key.
 * Handles both:
 *   - https://pub-xxx.r2.dev/listings/abc.jpg   → "listings/abc.jpg"
 *   - https://<acct>.r2.cloudflarestorage.com/propertyloop/listings/abc.jpg
 *       → "listings/abc.jpg"  (strip bucket prefix)
 */
function urlToKey(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    let pathname = u.pathname.replace(/^\/+/, '');
    // r2.cloudflarestorage.com URLs include the bucket as the first path segment
    if (
      u.host.endsWith('.r2.cloudflarestorage.com') &&
      pathname.startsWith(`${bucketName}/`)
    ) {
      pathname = pathname.slice(bucketName.length + 1);
    }
    return pathname || null;
  } catch {
    return null;
  }
}

async function main() {
  // 1) Pull the user with every relation that could hold media. Cast to
  //    any once so the nested field accesses below don't fight TS.
  const user: any = await prisma.user.findUnique({
    where: { email: targetEmail },
    include: {
      agentProfile: true,
      vendorProfile: true,
      listings: { include: { documents: true } },
      vendorJobs: true,        // jobs where they ARE the vendor
      vendorBookings: true,    // jobs where they're the buyer/booker
    } as any,
  });

  if (!user) {
    console.log(`No user found for ${targetEmail}. Nothing to do.`);
    await prisma.$disconnect();
    return;
  }

  // 2) Collect every URL across every relation
  const urls: string[] = [];

  if (user.avatarUrl) urls.push(user.avatarUrl);
  if (user.vendorProfile?.bannerImage) urls.push(user.vendorProfile.bannerImage);
  if (user.vendorProfile?.portfolioImages?.length)
    urls.push(...user.vendorProfile.portfolioImages);

  for (const l of (user as any).listings ?? []) {
    if (l.coverImage) urls.push(l.coverImage);
    if (Array.isArray(l.images)) urls.push(...l.images);
    if (l.videoUrl) urls.push(l.videoUrl);
    for (const d of l.documents ?? []) {
      if (d.url) urls.push(d.url);
    }
  }

  for (const j of [
    ...((user as any).vendorJobs ?? []),
    ...((user as any).vendorBookings ?? []),
  ]) {
    if (Array.isArray(j.attachments)) urls.push(...j.attachments);
    if (Array.isArray(j.completionProofImages))
      urls.push(...j.completionProofImages);
  }

  // 3) Map URLs → R2 keys (filter out non-R2 URLs and dedupe)
  const r2HostPattern = /\.r2\.(dev|cloudflarestorage\.com)$|^pub-[a-z0-9]+\.r2\.dev$/;
  const keys = Array.from(
    new Set(
      urls
        .map((u) => {
          try {
            const host = new URL(u).host;
            if (!r2HostPattern.test(host) && !host.includes('.r2.')) return null;
            return urlToKey(u);
          } catch {
            return null;
          }
        })
        .filter((k): k is string => !!k),
    ),
  );

  // 4) Print plan
  console.log('═══ Purge plan ═══');
  console.log(`User: ${user.email} (${user.name}, role=${user.role}, id=${user.id})`);
  console.log(`Created: ${user.createdAt.toISOString()}`);
  console.log('');
  console.log('Cascade preview (DB rows that disappear via Prisma cascade):');
  console.log(`  listings              : ${(user as any).listings?.length ?? 0}`);
  console.log(`  listing documents     : ${
    ((user as any).listings ?? []).reduce(
      (acc: number, l: any) => acc + (l.documents?.length ?? 0),
      0,
    )
  }`);
  console.log(`  vendor jobs (as vendor): ${(user as any).vendorJobs?.length ?? 0}`);
  console.log(`  vendor bookings (buyer): ${(user as any).vendorBookings?.length ?? 0}`);
  console.log(`  agentProfile          : ${user.agentProfile ? 'yes' : 'no'}`);
  console.log(`  vendorProfile         : ${user.vendorProfile ? 'yes' : 'no'}`);
  console.log('');
  console.log(`R2 objects to delete: ${keys.length}`);
  for (const k of keys) console.log(`  ↓ ${k}`);

  if (!confirm) {
    console.log('\n▶ Dry-run only. Re-run with --confirm to execute.');
    await prisma.$disconnect();
    return;
  }

  console.log('\n🔥 Executing...');

  // 5) Delete R2 objects (best-effort, log failures)
  let r2Deleted = 0;
  let r2Failed = 0;
  for (const key of keys) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
      r2Deleted++;
    } catch (err: any) {
      r2Failed++;
      console.error(`  ✗ R2 delete failed for ${key}:`, err?.message ?? err);
    }
  }
  console.log(`  ✓ R2 deletes: ${r2Deleted} ok, ${r2Failed} failed`);

  // 6) Delete the User row — Prisma cascade handles the rest
  try {
    await prisma.user.delete({ where: { id: user.id } });
    console.log('  ✓ User row deleted (cascade complete)');
  } catch (err: any) {
    console.error('  ✗ User delete failed:', err?.message ?? err);
  }

  console.log(`\nPublic URL base: ${publicUrl}`);
  console.log('Done.');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
