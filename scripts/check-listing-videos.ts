/**
 * Diagnostic: list the most recent listings and confirm whether their
 * videoUrl is set, plus HEAD-check the file in R2 to confirm it actually
 * exists in the bucket.
 *
 * Run with: npx ts-node scripts/check-listing-videos.ts
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not set');
const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter } as any);

async function checkUrl(url: string): Promise<string> {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    const size = res.headers.get('content-length');
    const sizeMb = size ? `${(parseInt(size) / 1024 / 1024).toFixed(2)} MB` : 'unknown size';
    return `${res.status} ${res.statusText} · ${sizeMb}`;
  } catch (e: any) {
    return `FETCH FAILED: ${e.message}`;
  }
}

async function main() {
  const listings = await prisma.listing.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      title: true,
      type: true,
      status: true,
      videoUrl: true,
      virtualTourUrl: true,
      createdAt: true,
    },
  });

  console.log(`\nMost recent ${listings.length} listings:\n`);
  for (const l of listings) {
    console.log(`─── ${l.title}`);
    console.log(`    id=${l.id}`);
    console.log(`    type=${l.type}  status=${l.status}`);
    console.log(`    created=${l.createdAt.toISOString()}`);
    console.log(`    videoUrl=${l.videoUrl ?? 'null'}`);
    if (l.videoUrl && l.videoUrl.startsWith('http')) {
      const result = await checkUrl(l.videoUrl);
      console.log(`    HEAD     → ${result}`);
    }
    if (l.virtualTourUrl) {
      console.log(`    virtualTourUrl=${l.virtualTourUrl}`);
    }
    console.log('');
  }

  const withVideo = await prisma.listing.count({
    where: { videoUrl: { not: null } },
  });
  const total = await prisma.listing.count();
  console.log(`\nSummary: ${withVideo} of ${total} listings have a videoUrl.\n`);
}

main()
  .catch((err) => {
    console.error('Diagnostic failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
