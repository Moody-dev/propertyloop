/**
 * One-off backfill: move existing agents who have no subscription tier onto the
 * FREE plan (ACTIVE) so they get the 3-listing free allowance. Agents already on
 * FOUNDING/STANDARD/PRO are left untouched. Idempotent — safe to re-run.
 *
 *   npx ts-node --transpile-only prisma/scripts/backfill-free-tier.ts
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import {
  PrismaClient,
  SubscriptionTier,
  SubscriptionStatus,
} from '../../generated/prisma/client';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL environment variable is not set');

const pool = new Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  const pending = await prisma.agentProfile.count({
    where: { subscriptionTier: null },
  });
  console.log(`Agents with no subscription tier: ${pending}`);

  if (pending === 0) {
    console.log('Nothing to backfill.');
    return;
  }

  const res = await prisma.agentProfile.updateMany({
    where: { subscriptionTier: null },
    data: {
      subscriptionTier: SubscriptionTier.FREE,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
    },
  });
  console.log(`Backfilled ${res.count} agent(s) to FREE / ACTIVE.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
