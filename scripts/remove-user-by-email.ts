/**
 * Surgically remove a single User by email and reset their corresponding
 * WaitlistEntry (if any) so the invite link still works for a clean re-signup.
 *
 * Usage:
 *   npx ts-node scripts/remove-user-by-email.ts --email=foo@example.com
 *   npx ts-node scripts/remove-user-by-email.ts --email=foo@example.com --confirm
 *
 * Always lookup case-insensitively. Cascade deletes handle agent/vendor
 * profiles, listings, conversations, viewings, etc. VendorJob.vendorUserId
 * has onDelete:Restrict, so any matching jobs are deleted explicitly first.
 *
 * Refuses to touch ADMIN users.
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Role } from '../generated/prisma/client';

const args = process.argv.slice(2);
const emailArg = args.find((a) => a.startsWith('--email='));
const email = emailArg ? emailArg.split('=')[1].trim().toLowerCase() : null;
const confirm = args.includes('--confirm');

if (!email) {
  console.error('Usage: --email=foo@example.com [--confirm]');
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not set');
const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  console.log(`═══ Remove user by email ═══`);
  console.log(`Email:     ${email}`);
  console.log(`Mode:      ${confirm ? '🔥 EXECUTE' : 'DRY-RUN'}\n`);

  // Case-insensitive lookup
  const users = await prisma.user.findMany({
    where: { email: { equals: email!, mode: 'insensitive' } },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
    },
  });
  const waitlist = await prisma.waitlistEntry.findMany({
    where: { email: { equals: email!, mode: 'insensitive' } },
  });

  console.log(`Users found:    ${users.length}`);
  for (const u of users) {
    console.log(
      `  • ${u.email} | ${u.name} | role=${u.role} | createdAt=${u.createdAt.toISOString()}`,
    );
  }
  console.log(`Waitlist found: ${waitlist.length}`);
  for (const w of waitlist) {
    console.log(
      `  • ${w.email} | ${w.first_name} ${w.last_name} | activated=${w.activated} | type=${w.type}`,
    );
  }
  console.log('');

  // Refuse to touch admins
  const admins = users.filter((u) => u.role === Role.ADMIN);
  if (admins.length) {
    console.error('✗ Refusing to remove an ADMIN user. Aborting.');
    return;
  }

  if (users.length === 0 && waitlist.every((w) => !w.activated)) {
    console.log('Nothing to do — no User row exists and no activated waitlist entry.');
    return;
  }

  // Cascade preview
  const ids = users.map((u) => u.id);
  if (ids.length) {
    const [listings, vendorJobs, viewings, messages, bookmarks] =
      await Promise.all([
        prisma.listing.count({ where: { agentId: { in: ids } } }),
        prisma.vendorJob.count({ where: { vendorUserId: { in: ids } } }),
        prisma.viewing.count({ where: { agentId: { in: ids } } }),
        prisma.message.count({ where: { senderUserId: { in: ids } } }),
        prisma.bookmark.count({ where: { userId: { in: ids } } }),
      ]);
    console.log('Cascade preview (rows that will disappear):');
    console.log(`  listings    : ${listings}`);
    console.log(`  vendor jobs : ${vendorJobs}`);
    console.log(`  viewings    : ${viewings}`);
    console.log(`  messages    : ${messages}`);
    console.log(`  bookmarks   : ${bookmarks}`);
    console.log('');
  }

  // Snapshot
  const outDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotPath = path.join(outDir, `user-removal-${stamp}.json`);
  fs.writeFileSync(
    snapshotPath,
    JSON.stringify(
      {
        email,
        executedAt: new Date().toISOString(),
        mode: confirm ? 'execute' : 'dry-run',
        users,
        waitlist: waitlist.map((w) => ({
          id: w.id,
          email: w.email,
          first_name: w.first_name,
          last_name: w.last_name,
          activated: w.activated,
          type: w.type,
        })),
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

  console.log('🔥 Executing...');

  // 1. Delete vendor jobs (Restrict FK)
  if (ids.length) {
    const jobs = await prisma.vendorJob.deleteMany({
      where: { vendorUserId: { in: ids } },
    });
    console.log(`  ✓ vendor jobs deleted: ${jobs.count}`);

    // 2. Delete user (cascade handles everything else)
    const removed = await prisma.user.deleteMany({ where: { id: { in: ids } } });
    console.log(`  ✓ users deleted:       ${removed.count}`);
  }

  // 3. Reset matching WaitlistEntry rows so their invite token still works
  if (waitlist.length) {
    const reset = await prisma.waitlistEntry.updateMany({
      where: { id: { in: waitlist.map((w) => w.id) } },
      data: { activated: false, activatedAt: null },
    });
    console.log(`  ✓ waitlist entries reset (activated→false): ${reset.count}`);
  }

  console.log(`\n✓ Done. Snapshot at: ${snapshotPath}`);
}

main()
  .catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
