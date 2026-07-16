/**
 * Read-only verification that the referral schema + queries work against the
 * live DB. Makes NO writes. Run once:
 *
 *   npx ts-node scripts/verify-referrals.ts
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../generated/prisma/client';
import 'dotenv/config';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL not set');
const pool = new Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  const cols = await prisma.$queryRawUnsafe<any[]>(`
    SELECT column_name, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'User' AND column_name IN ('referralCode','referredById')
    ORDER BY column_name;`);
  console.log('Columns:', cols);

  const idx = await prisma.$queryRawUnsafe<any[]>(`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'User' AND indexname = 'User_referralCode_key';`);
  console.log('Unique index on referralCode present:', idx.length === 1);

  const fk = await prisma.$queryRawUnsafe<any[]>(`
    SELECT conname FROM pg_constraint WHERE conname = 'User_referredById_fkey';`);
  console.log('Self-referential FK present:', fk.length === 1);

  // Exercise the exact admin leaderboard query shape.
  const top = await prisma.user.findMany({
    take: 5,
    select: {
      id: true,
      referralCode: true,
      referredBy: { select: { id: true, name: true } },
      _count: { select: { referrals: true } },
    },
    orderBy: [{ referrals: { _count: 'desc' } }, { createdAt: 'desc' }],
  });
  console.log('Leaderboard query OK. Top rows:', top.map((u) => ({
    hasCode: !!u.referralCode,
    referredBy: u.referredBy?.name ?? null,
    referrals: u._count.referrals,
  })));

  const totalReferred = await prisma.user.count({
    where: { referredById: { not: null }, deletedAt: null },
  });
  console.log('Total referred signups:', totalReferred);

  const missing = await prisma.user.count({ where: { referralCode: null } });
  const total = await prisma.user.count();
  console.log(`Users needing lazy code backfill: ${missing} of ${total}`);

  console.log('\nOK — schema + queries verified (read-only).');
}

main()
  .catch((e) => {
    console.error('FAILED:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
