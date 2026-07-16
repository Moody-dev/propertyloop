/**
 * One-shot backfill: give every existing user a referral code so their
 * personalized link works immediately and the admin leaderboard is populated,
 * without waiting for each user to open their referral panel.
 *
 *   npx ts-node scripts/backfill-referral-codes.ts            # dry run (report only)
 *   npx ts-node scripts/backfill-referral-codes.ts --apply    # writes codes
 *
 * Idempotent: only touches users whose referralCode is currently null.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../generated/prisma/client';
import { generateReferralCode } from '../src/common/referral';
import 'dotenv/config';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL not set');
const pool = new Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

const apply = process.argv.includes('--apply');

async function allocate(taken: Set<string>): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = generateReferralCode();
    if (!taken.has(code)) {
      taken.add(code);
      return code;
    }
  }
  throw new Error('Could not allocate a unique referral code after 10 tries');
}

async function main() {
  const withCode = await prisma.user.findMany({
    where: { referralCode: { not: null } },
    select: { referralCode: true },
  });
  const taken = new Set(withCode.map((u) => u.referralCode as string));

  const missing = await prisma.user.findMany({
    where: { referralCode: null },
    select: { id: true, name: true },
  });

  console.log(`${missing.length} user(s) without a referral code.`);
  if (!apply) {
    console.log('DRY RUN — pass --apply to write codes.');
  }

  let done = 0;
  for (const u of missing) {
    const code = await allocate(taken);
    if (apply) {
      await prisma.user.update({
        where: { id: u.id },
        data: { referralCode: code },
      });
    }
    done++;
    console.log(`${apply ? 'Set' : 'Would set'} ${code} for ${u.name}`);
  }

  console.log(`\n${apply ? 'Backfilled' : 'Would backfill'} ${done} user(s).`);
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
