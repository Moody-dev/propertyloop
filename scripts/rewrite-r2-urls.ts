/**
 * One-shot migration: replace the R2 S3-endpoint prefix on existing
 * Listing.coverImage, Listing.images, and ListingDocument.url with the
 * new public r2.dev prefix so browsers can load the files.
 *
 * Run with: npx tsx scripts/rewrite-r2-urls.ts
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const OLD_PREFIX =
  'https://158f3ccc89076c431c395d201cdc3d35.r2.cloudflarestorage.com/propertyloop';
const NEW_PREFIX = 'https://pub-c898594ed0304afe82dc69a1e671d46b.r2.dev';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not set');
const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter } as any);

const swap = (s: string | null | undefined) =>
  s && s.startsWith(OLD_PREFIX) ? NEW_PREFIX + s.slice(OLD_PREFIX.length) : s;

async function main() {
  console.log(`Rewriting URLs:\n  ${OLD_PREFIX}\n→ ${NEW_PREFIX}\n`);

  // ─── Listings ────────────────────────────────────────────────────────────
  const listings = await prisma.listing.findMany({
    select: { id: true, coverImage: true, images: true },
  });

  let listingChanges = 0;
  for (const l of listings) {
    const newCover = swap(l.coverImage) ?? null;
    const newImages = l.images.map((u) => swap(u) ?? u);

    const coverChanged = newCover !== l.coverImage;
    const imagesChanged = newImages.some((u, i) => u !== l.images[i]);
    if (!coverChanged && !imagesChanged) continue;

    await prisma.listing.update({
      where: { id: l.id },
      data: {
        ...(coverChanged && { coverImage: newCover }),
        ...(imagesChanged && { images: newImages }),
      },
    });
    listingChanges++;
  }
  console.log(`Listings updated: ${listingChanges}/${listings.length}`);

  // ─── Documents ───────────────────────────────────────────────────────────
  const docs = await prisma.listingDocument.findMany({
    select: { id: true, url: true },
  });

  let docChanges = 0;
  for (const d of docs) {
    const newUrl = swap(d.url);
    if (newUrl === d.url) continue;
    await prisma.listingDocument.update({
      where: { id: d.id },
      data: { url: newUrl },
    });
    docChanges++;
  }
  console.log(`Documents updated: ${docChanges}/${docs.length}`);

  // ─── User avatars ────────────────────────────────────────────────────────
  const users = await prisma.user.findMany({
    select: { id: true, avatarUrl: true },
    where: { avatarUrl: { not: null } },
  });

  let userChanges = 0;
  for (const u of users) {
    const newUrl = swap(u.avatarUrl);
    if (newUrl === u.avatarUrl) continue;
    await prisma.user.update({
      where: { id: u.id },
      data: { avatarUrl: newUrl },
    });
    userChanges++;
  }
  console.log(`User avatars updated: ${userChanges}/${users.length}`);

  console.log('\nDone.');
}

main()
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
