/**
 * One-shot: recompute every vendor's `jobsCount` from their completed jobs —
 * status COMPLETED or PAID, excluding refunded ones. Run once after deploying
 * the fix that increments jobsCount when a job is marked complete; it heals
 * vendors whose already-completed jobs were never counted (the increment write
 * didn't exist before).
 *
 *   npx ts-node scripts/backfill-vendor-jobs-count.ts          # dry run, prints changes
 *   npx ts-node scripts/backfill-vendor-jobs-count.ts --write  # apply the changes
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient, JobStatus, EscrowStatus } from '../generated/prisma/client';

const write = process.argv.includes('--write');

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');

  const pool = new Pool({ connectionString: databaseUrl });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter } as any);

  // True count of completed (delivered, not refunded) jobs per vendor.
  const grouped = await prisma.vendorJob.groupBy({
    by: ['vendorUserId'],
    where: {
      status: { in: [JobStatus.COMPLETED, JobStatus.PAID] },
      NOT: { escrowStatus: EscrowStatus.REFUNDED },
    },
    _count: { _all: true },
  });
  const wanted = new Map<string, number>();
  for (const g of grouped) wanted.set(g.vendorUserId, g._count._all);

  const profiles = await prisma.vendorProfile.findMany({
    select: { userId: true, jobsCount: true, user: { select: { name: true } } },
  });

  let changed = 0;
  for (const p of profiles) {
    const target = wanted.get(p.userId) ?? 0;
    if (target === p.jobsCount) continue;
    changed++;
    console.log(`${p.user?.name ?? p.userId}: ${p.jobsCount} → ${target}`);
    if (write) {
      await prisma.vendorProfile.update({
        where: { userId: p.userId },
        data: { jobsCount: target },
      });
    }
  }

  console.log(
    `\n${changed} vendor(s) ${write ? 'updated' : 'would change'} ` +
      `(${profiles.length} profiles scanned).`,
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
