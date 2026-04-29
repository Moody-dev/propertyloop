/**
 * Recompute AgentProfile.listingsCount and AgentProfile.soldRentedCount
 * from the actual Listing rows. Useful when those denormalised counters
 * drift from reality (silent increment failures, manual DB fixes, etc.).
 *
 * Counts:
 *   listingsCount   = listings owned by the agent that aren't ARCHIVED
 *                     (ACTIVE | PENDING_REVIEW | PAUSED | SOLD | RENTED)
 *   soldRentedCount = listings owned by the agent with status SOLD or RENTED
 *
 * Usage:
 *   npx ts-node scripts/sync-agent-counters.ts                # dry-run
 *   npx ts-node scripts/sync-agent-counters.ts --confirm      # write
 *   npx ts-node scripts/sync-agent-counters.ts --email=foo@bar.com [--confirm]
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, ListingStatus, Role } from '../generated/prisma/client';

const args = process.argv.slice(2);
const confirm = args.includes('--confirm');
const emailArg = args.find((a) => a.startsWith('--email='));
const email = emailArg ? emailArg.split('=')[1].trim().toLowerCase() : null;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not set');
const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  console.log('═══ Sync agent counters ═══');
  console.log(`Scope: ${email ? `email=${email}` : 'all agents'}`);
  console.log(`Mode:  ${confirm ? '🔥 EXECUTE' : 'DRY-RUN'}\n`);

  const where: any = { role: Role.AGENT };
  if (email) where.email = { equals: email, mode: 'insensitive' };

  const agents = await prisma.user.findMany({
    where,
    select: {
      id: true,
      email: true,
      name: true,
      agentProfile: {
        select: { id: true, listingsCount: true, soldRentedCount: true },
      },
    },
  });

  if (agents.length === 0) {
    console.log('No matching agents found.');
    return;
  }

  let drifted = 0;
  let fixed = 0;

  for (const agent of agents) {
    if (!agent.agentProfile) {
      console.log(`⚠ ${agent.email} — no agentProfile row`);
      continue;
    }

    // Real counts from listings
    const [listingsTotal, soldRentedTotal] = await Promise.all([
      prisma.listing.count({
        where: {
          agentId: agent.id,
          status: { not: ListingStatus.ARCHIVED },
        },
      }),
      prisma.listing.count({
        where: {
          agentId: agent.id,
          status: { in: [ListingStatus.SOLD, ListingStatus.RENTED] },
        },
      }),
    ]);

    const before = agent.agentProfile;
    const listingsDrift = listingsTotal !== before.listingsCount;
    const soldDrift = soldRentedTotal !== before.soldRentedCount;

    if (!listingsDrift && !soldDrift) continue;

    drifted++;
    console.log(
      `${agent.email} — ${agent.name}\n  listingsCount   ${before.listingsCount} → ${listingsTotal}${listingsDrift ? '  ⚠' : ''}\n  soldRentedCount ${before.soldRentedCount} → ${soldRentedTotal}${soldDrift ? '  ⚠' : ''}`,
    );

    if (confirm) {
      await prisma.agentProfile.update({
        where: { id: before.id },
        data: {
          listingsCount: listingsTotal,
          soldRentedCount: soldRentedTotal,
        },
      });
      fixed++;
    }
  }

  console.log('\n══════ DONE ══════');
  console.log(`Agents scanned: ${agents.length}`);
  console.log(`Drifted:        ${drifted}`);
  console.log(`Fixed:          ${confirm ? fixed : '(dry-run — re-run with --confirm)'}`);
}

main()
  .catch((err) => {
    console.error('Sync failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
