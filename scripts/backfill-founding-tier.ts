/**
 * One-shot backfill: grant FOUNDING tier (ACTIVE) to any existing AGENT user
 * whose email is on the original PropertyLoop WaitlistEntry list. This is the
 * counterpart to the signup-hook in auth.service.ts — it handles the agents
 * who were already created before the subscription system shipped.
 *
 *   npx ts-node scripts/backfill-founding-tier.ts            # dry run
 *   npx ts-node scripts/backfill-founding-tier.ts --apply    # writes
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import {
  PrismaClient,
  Role,
  SubscriptionStatus,
  SubscriptionTier,
  UserType,
} from '../generated/prisma/client';
import 'dotenv/config';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL environment variable is not set');
}
const pool = new Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

const apply = process.argv.includes('--apply');

async function main() {
  const waitlistAgents = await prisma.waitlistEntry.findMany({
    where: { type: UserType.REAL_ESTATE_AGENT },
    select: { id: true, email: true, activated: true },
  });
  const byEmail = new Map(waitlistAgents.map((w) => [w.email.toLowerCase(), w]));

  const candidates = await prisma.user.findMany({
    where: {
      role: Role.AGENT,
      deletedAt: null,
      email: { in: Array.from(byEmail.keys()) },
      agentProfile: {
        is: {
          OR: [
            { subscriptionTier: null },
            { subscriptionStatus: { not: SubscriptionStatus.ACTIVE } },
          ],
        },
      },
    },
    select: {
      id: true,
      email: true,
      name: true,
      agentProfile: {
        select: {
          id: true,
          subscriptionTier: true,
          subscriptionStatus: true,
        },
      },
    },
  });

  console.log(
    `Found ${candidates.length} agent(s) on the waitlist needing FOUNDING grant.\n`,
  );
  for (const u of candidates) {
    const cur = u.agentProfile
      ? `${u.agentProfile.subscriptionTier ?? 'null'}/${u.agentProfile.subscriptionStatus ?? 'null'}`
      : 'no-profile';
    console.log(`  ${u.email.padEnd(40)} ${u.name.padEnd(28)} ${cur}`);
  }

  if (!apply) {
    console.log('\nDry run — pass --apply to write.');
    return;
  }

  let updated = 0;
  for (const u of candidates) {
    if (!u.agentProfile) continue;
    const wl = byEmail.get(u.email.toLowerCase());
    await prisma.$transaction([
      prisma.agentProfile.update({
        where: { id: u.agentProfile.id },
        data: {
          subscriptionTier: SubscriptionTier.FOUNDING,
          subscriptionStatus: SubscriptionStatus.ACTIVE,
        },
      }),
      ...(wl && !wl.activated
        ? [
            prisma.waitlistEntry.update({
              where: { id: wl.id },
              data: { activated: true, activatedAt: new Date() },
            }),
          ]
        : []),
    ]);
    updated += 1;
  }
  console.log(`\nUpdated ${updated} agent profile(s) to FOUNDING/ACTIVE.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
