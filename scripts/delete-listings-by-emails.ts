/**
 * Delete every Listing owned by one or more agents (looked up by email).
 * The agent's User account is left intact — only their listings disappear.
 *
 * Usage:
 *   npx ts-node scripts/delete-listings-by-emails.ts --emails=a@x.com,b@x.com
 *   npx ts-node scripts/delete-listings-by-emails.ts --emails=a@x.com,b@x.com --confirm
 *
 * Cascade deletes (per schema.prisma) handle ListingDocument, ListingMedia,
 * Bookmark, Lead, Viewing, ListingPriceHistory, ShortletBooking, RentalAgreement,
 * and LogbookEntry rows. AgentProfile.listingsCount is reset to the new actual
 * count after deletion.
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const args = process.argv.slice(2);
const emailsArg = args.find((a) => a.startsWith('--emails='));
const emails = emailsArg
  ? emailsArg
      .split('=')[1]
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  : [];
const confirm = args.includes('--confirm');

if (emails.length === 0) {
  console.error('Usage: --emails=a@x.com,b@x.com [--confirm]');
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not set');
const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  console.log(`═══ Delete listings by agent email ═══`);
  console.log(`Emails: ${emails.join(', ')}`);
  console.log(`Mode:   ${confirm ? '🔥 EXECUTE' : 'DRY-RUN'}\n`);

  const users = await prisma.user.findMany({
    where: {
      OR: emails.map((email) => ({
        email: { equals: email, mode: 'insensitive' as const },
      })),
    },
    select: { id: true, email: true, name: true, role: true },
  });

  if (users.length === 0) {
    console.log('No matching users found. Nothing to do.');
    return;
  }

  console.log(`Users found: ${users.length}`);
  for (const u of users) {
    console.log(`  • ${u.email} | ${u.name} | role=${u.role}`);
  }
  console.log('');

  const userIds = users.map((u) => u.id);
  const listings = await prisma.listing.findMany({
    where: { agentId: { in: userIds } },
    select: { id: true, title: true, agentId: true, status: true, type: true },
    orderBy: { createdAt: 'desc' },
  });

  console.log(`Listings to delete: ${listings.length}`);
  for (const l of listings) {
    const owner = users.find((u) => u.id === l.agentId);
    console.log(
      `  • [${l.status}] ${l.type} "${l.title}" — ${owner?.email ?? l.agentId}`,
    );
  }
  console.log('');

  // Snapshot
  const outDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotPath = path.join(outDir, `listings-deletion-${stamp}.json`);
  fs.writeFileSync(
    snapshotPath,
    JSON.stringify(
      {
        emails,
        executedAt: new Date().toISOString(),
        mode: confirm ? 'execute' : 'dry-run',
        users,
        listings,
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log(`Snapshot: ${snapshotPath}\n`);

  if (!confirm) {
    console.log('▶  Dry-run only. Re-run with --confirm to actually delete.');
    return;
  }

  if (listings.length === 0) {
    console.log('No listings to delete.');
    return;
  }

  console.log('🔥 Executing...');
  const removed = await prisma.listing.deleteMany({
    where: { id: { in: listings.map((l) => l.id) } },
  });
  console.log(`  ✓ listings deleted: ${removed.count}`);

  // Reset listingsCount on each agent profile to the actual remaining count
  for (const u of users) {
    const remaining = await prisma.listing.count({ where: { agentId: u.id } });
    await prisma.agentProfile
      .update({
        where: { userId: u.id },
        data: { listingsCount: remaining },
      })
      .catch(() => {
        /* user may not have an agentProfile — ignore */
      });
    console.log(`  ✓ ${u.email} listingsCount → ${remaining}`);
  }

  console.log(`\n✓ Done. Snapshot at: ${snapshotPath}`);
}

main()
  .catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
