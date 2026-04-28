/**
 * Surgical wipe of test/dev data so the platform is clean for the curated
 * waitlist agents activating from today onward.
 *
 * Deletes every non-ADMIN User created BEFORE the cutoff. Cascading FKs in
 * the schema clean up listings, conversations, messages, viewings, vendor
 * earnings, vendor reviews, agent reviews, leads, bookmarks, logbook entries,
 * and price history automatically.
 *
 * The single FK that won't cascade is VendorJob.vendorUserId (onDelete:
 * Restrict). This script handles that explicitly by deleting matching
 * VendorJobs before the User rows.
 *
 * Preserved no matter what:
 *   - Every User where role = 'ADMIN'
 *   - Every User where createdAt >= cutoff (the 21 curated agents who
 *     activate from today onward land here)
 *   - All WaitlistEntry rows (the JWT invite tokens reference wlId — wiping
 *     them would break every outstanding invite)
 *
 * Usage:
 *   npx ts-node scripts/wipe-platform-data.ts                   # dry-run
 *   npx ts-node scripts/wipe-platform-data.ts --confirm         # execute
 *   npx ts-node scripts/wipe-platform-data.ts --cutoff=2026-04-28
 *
 * Snapshot of doomed users is written to scripts/output/wipe-snapshot-*.json
 * before any deletion happens. Treat as a paper-trail / undo reference.
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Role } from '../generated/prisma/client';

const args = process.argv.slice(2);
const confirm = args.includes('--confirm');
const cutoffArg = args.find((a) => a.startsWith('--cutoff='));
const cutoffStr = cutoffArg ? cutoffArg.split('=')[1] : '2026-04-28';
const cutoff = new Date(`${cutoffStr}T00:00:00.000Z`);

if (Number.isNaN(cutoff.getTime())) {
  console.error(`Invalid --cutoff: ${cutoffStr}. Expected YYYY-MM-DD.`);
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not set');
const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter } as any);

async function tableCounts(deadUserIds: string[]) {
  if (deadUserIds.length === 0) {
    return {
      listings: 0,
      vendorJobs: 0,
      vendorEarnings: 0,
      vendorReviews: 0,
      viewings: 0,
      conversations: 0,
      messages: 0,
      bookmarks: 0,
      leads: 0,
      logbookEntries: 0,
    };
  }

  // Count rows that will disappear (directly or via cascade)
  const [
    listings,
    vendorJobs,
    vendorEarnings,
    vendorReviews,
    viewings,
    conversationParticipants,
    messages,
    bookmarks,
    leads,
    logbookEntries,
  ] = await Promise.all([
    prisma.listing.count({ where: { agentId: { in: deadUserIds } } }),
    prisma.vendorJob.count({ where: { vendorUserId: { in: deadUserIds } } }),
    prisma.vendorEarning.count({ where: { vendorUserId: { in: deadUserIds } } }),
    prisma.vendorReview.count({ where: { vendorUserId: { in: deadUserIds } } }),
    prisma.viewing.count({ where: { agentId: { in: deadUserIds } } }),
    prisma.conversationParticipant.count({
      where: { userId: { in: deadUserIds } },
    }),
    prisma.message.count({ where: { senderUserId: { in: deadUserIds } } }),
    prisma.bookmark.count({ where: { userId: { in: deadUserIds } } }),
    prisma.lead.count({ where: { agentId: { in: deadUserIds } } }),
    prisma.logbookEntry.count({ where: { ownerUserId: { in: deadUserIds } } }),
  ]);

  // A conversation is wiped when *all* participants are dead users; here we
  // just report the participant rows since the conversation/message cascade
  // is handled by the schema.
  return {
    listings,
    vendorJobs,
    vendorEarnings,
    vendorReviews,
    viewings,
    conversations: conversationParticipants,
    messages,
    bookmarks,
    leads,
    logbookEntries,
  };
}

async function main() {
  console.log('═══ Surgical wipe ═══');
  console.log(`Cutoff (UTC): ${cutoff.toISOString()}`);
  console.log(`Mode:         ${confirm ? '🔥 EXECUTE' : 'DRY-RUN'}\n`);

  // Identify doomed users
  const dead = await prisma.user.findMany({
    where: {
      role: { not: Role.ADMIN },
      createdAt: { lt: cutoff },
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  // Counts for context
  const totalUsers = await prisma.user.count();
  const adminCount = await prisma.user.count({ where: { role: Role.ADMIN } });
  const survivors = await prisma.user.count({
    where: {
      role: { not: Role.ADMIN },
      createdAt: { gte: cutoff },
    },
  });
  const waitlistCount = await prisma.waitlistEntry.count();

  console.log('User landscape:');
  console.log(`  total users in DB        : ${totalUsers}`);
  console.log(`  admins (always preserved): ${adminCount}`);
  console.log(`  post-cutoff (preserved)  : ${survivors}`);
  console.log(`  pre-cutoff (TO DELETE)   : ${dead.length}`);
  console.log(`  waitlist entries (kept)  : ${waitlistCount}\n`);

  if (dead.length === 0) {
    console.log('Nothing to delete. Bye.');
    return;
  }

  // Group by role for clarity
  const byRole = dead.reduce<Record<string, number>>((acc, u) => {
    acc[u.role] = (acc[u.role] ?? 0) + 1;
    return acc;
  }, {});
  console.log('Doomed users by role:');
  for (const [role, n] of Object.entries(byRole)) {
    console.log(`  ${role.padEnd(8)}: ${n}`);
  }
  console.log('');

  // Cascade preview
  const deadIds = dead.map((u) => u.id);
  const counts = await tableCounts(deadIds);
  console.log('Cascade preview (rows that will disappear):');
  for (const [table, n] of Object.entries(counts)) {
    console.log(`  ${table.padEnd(20)}: ${n}`);
  }
  console.log('');

  // Snapshot for audit
  const outDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotPath = path.join(outDir, `wipe-snapshot-${stamp}.json`);
  fs.writeFileSync(
    snapshotPath,
    JSON.stringify(
      {
        cutoff: cutoff.toISOString(),
        executedAt: new Date().toISOString(),
        mode: confirm ? 'execute' : 'dry-run',
        counts,
        users: dead.map((u) => ({
          id: u.id,
          email: u.email,
          name: u.name,
          role: u.role,
          createdAt: u.createdAt.toISOString(),
        })),
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log(`Snapshot: ${snapshotPath}\n`);

  if (!confirm) {
    console.log('▶  This was a dry-run. Re-run with --confirm to actually delete.');
    return;
  }

  // ─── Execute ────────────────────────────────────────────────────────────
  console.log('🔥 Executing deletes...');

  // Step 1 — delete VendorJobs for dead vendors. VendorJob.vendorUserId is
  // onDelete: Restrict, so deleting a vendor user without first deleting
  // their jobs would throw. Cascades down to vendor earnings, vendor reviews
  // tied to those jobs, and detaches logbook entries (jobId SetNull).
  const jobsResult = await prisma.vendorJob.deleteMany({
    where: { vendorUserId: { in: deadIds } },
  });
  console.log(`  ✓ deleted vendor jobs:        ${jobsResult.count}`);

  // Step 2 — delete Users. Cascade handles everything else:
  //  AgentProfile, VendorProfile, VendorBankAccount, RefreshToken, sessions,
  //  Listings (and their documents, price history, bookmarks, logbook),
  //  Conversations + ConversationParticipants + Messages where sender,
  //  VendorEarnings (where vendor), VendorReviews (where vendor),
  //  AgentReviewsReceived, Leads (as agent), Viewings (as agent),
  //  LogbookEntries (as owner).
  const usersResult = await prisma.user.deleteMany({
    where: { id: { in: deadIds } },
  });
  console.log(`  ✓ deleted users:              ${usersResult.count}`);

  // Verify post-state
  const afterCounts = await tableCounts([]); // counts now scope-less; just do top-level
  const remainingUsers = await prisma.user.count();
  const remainingListings = await prisma.listing.count();
  const remainingViewings = await prisma.viewing.count();
  const remainingVendorJobs = await prisma.vendorJob.count();
  const remainingMessages = await prisma.message.count();
  const remainingWaitlist = await prisma.waitlistEntry.count();

  console.log('\nPost-wipe totals:');
  console.log(`  users in DB     : ${remainingUsers} (was ${totalUsers})`);
  console.log(`  listings        : ${remainingListings}`);
  console.log(`  viewings        : ${remainingViewings}`);
  console.log(`  vendor jobs     : ${remainingVendorJobs}`);
  console.log(`  messages        : ${remainingMessages}`);
  console.log(`  waitlist entries: ${remainingWaitlist} (untouched)`);

  // Sanity-suppress unused warning
  void afterCounts;

  console.log('\n✓ Done. Snapshot of deleted users at:\n  ' + snapshotPath);
}

main()
  .catch((err) => {
    console.error('Wipe failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
