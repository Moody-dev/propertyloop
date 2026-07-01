/**
 * Read-only: listing counts by status + how many active listings the public
 * feed would return (mirrors ListingsService.list default filter).
 *   npx ts-node scripts/inspect-listings.ts
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient, ListingStatus } from '../generated/prisma/client';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  const pool = new Pool({ connectionString: databaseUrl });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter } as any);

  const byStatus = await prisma.listing.groupBy({
    by: ['status'],
    _count: { _all: true },
  });
  console.log('Listings by status:');
  for (const g of byStatus) console.log(`  ${g.status}: ${g._count._all}`);

  const publicCount = await prisma.listing.count({
    where: {
      status: ListingStatus.ACTIVE,
      agent: { isActive: true, deletedAt: null },
    },
  });
  console.log(`\nPublic feed (ACTIVE + live agent) total: ${publicCount}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});