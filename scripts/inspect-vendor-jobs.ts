/**
 * Read-only: print each vendor's job counts grouped by status, so we can see
 * why a "completed" job isn't reflected in jobsCount (which only counts PAID).
 *
 *   npx ts-node scripts/inspect-vendor-jobs.ts
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../generated/prisma/client';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  const pool = new Pool({ connectionString: databaseUrl });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter } as any);

  const grouped = await prisma.vendorJob.groupBy({
    by: ['vendorUserId', 'status'],
    _count: { _all: true },
  });

  if (grouped.length === 0) {
    console.log('No vendor jobs exist in the database at all.');
  } else {
    const names = await prisma.user.findMany({
      where: { id: { in: [...new Set(grouped.map((g) => g.vendorUserId))] } },
      select: { id: true, name: true },
    });
    const nameOf = new Map(names.map((n) => [n.id, n.name]));
    for (const g of grouped) {
      console.log(
        `${nameOf.get(g.vendorUserId) ?? g.vendorUserId} — ${g.status}: ${g._count._all}`,
      );
    }
  }
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
