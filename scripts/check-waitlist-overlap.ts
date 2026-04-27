/**
 * Cross-checks the agent list pasted into this script against the
 * WaitlistEntry table.
 *
 * Run with: npx ts-node scripts/check-waitlist-overlap.ts
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

// ─── Source list (from the Google Doc the client shared) ──────────────────
const docEmails: { name: string; email: string }[] = [
  { name: 'Boluwatife Daniels', email: 'danielsboluwatife@gmail.com' },
  { name: 'Sheriff Oyewo', email: 'oyewosheriff@gmail.com' },
  { name: 'Okechukwu Ugonna Buchi', email: 'buchiokechukwu@gmail.com' },
  { name: 'Chidozie James Chukwuemeka', email: 'terijamhomesandproperties@gmail.com' },
  { name: 'Omojoye Destiny', email: 'augustinedestiny15@gmail.com' },
  { name: 'Oluwatimilehin Okunlola', email: 'omodolapookunlola@gmail.com' },
  { name: 'Meghen Jonas', email: 'amieejonas@gmail.com' },
  { name: 'Adedolapo Olatinwo', email: 'adedollyolatino525@gmail.com' },
  { name: 'Obinna Onyeabor', email: 'michaelobinna522@gmail.com' },
  { name: 'Anita Ogedegbe', email: 'peteranita448@gmail.com' },
  { name: 'Adetayo Olorunjube', email: 'adetayoolorunjube@gmail.com' },
  { name: 'David Olaleru', email: 'davidolaleru@gmail.com' },
  { name: 'Josephine Michael', email: 'uwemJosephine8@gmail.com' },
  { name: 'Umar Jehohaniyi', email: 'officiallegitagent@gmail.com' },
  { name: 'Oho Rolland', email: 'ohorolland@gmail.com' },
  { name: 'Nuru Deen', email: 'info@dms.com.ng' },
  { name: 'Prince Uche Okocha', email: 'ucheprince572@gmail.com' },
  { name: 'Subhanallah Bello', email: 'subhanallahbello@gmail.com' },
  { name: 'Sunday Gbenga', email: 'olaniyansunday847@gmail.com' },
  { name: 'Green Psyche', email: 'greenpsyche1800@gmail.com' },
  { name: 'Saheed Olanrewaju', email: 'naturelimited@gmail.com' },
  { name: 'Olanrewaju Fadeyi', email: 'bigmanlanre@gmail.com' },
  { name: 'Ibrahim Agboola', email: 'appliedweber01@gmail.com' },
];

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not set');
const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter } as any);

const norm = (e: string) => e.trim().toLowerCase();

async function main() {
  // De-dupe the doc list ourselves first
  const seen = new Set<string>();
  const docDupes: string[] = [];
  const uniqueDoc = docEmails.filter((d) => {
    const key = norm(d.email);
    if (seen.has(key)) {
      docDupes.push(d.email);
      return false;
    }
    seen.add(key);
    return true;
  });

  // Pull every email from the waitlist
  const waitlist = await prisma.waitlistEntry.findMany({
    select: { email: true, type: true, first_name: true, last_name: true },
  });
  const waitlistMap = new Map(waitlist.map((w) => [norm(w.email), w]));

  // Also check if any are already platform users
  const existingUsers = await prisma.user.findMany({
    where: {
      email: { in: uniqueDoc.map((d) => norm(d.email)) },
    },
    select: { email: true, role: true, name: true },
  });
  const userMap = new Map(existingUsers.map((u) => [norm(u.email), u]));

  const inWaitlist: typeof uniqueDoc = [];
  const notInWaitlist: typeof uniqueDoc = [];
  const alreadyOnPlatform: typeof uniqueDoc = [];

  for (const d of uniqueDoc) {
    const k = norm(d.email);
    if (userMap.has(k)) alreadyOnPlatform.push(d);
    else if (waitlistMap.has(k)) inWaitlist.push(d);
    else notInWaitlist.push(d);
  }

  console.log('\n══════ WAITLIST OVERLAP REPORT ══════');
  console.log(`\nTotal rows in doc:        ${docEmails.length}`);
  console.log(`Unique doc emails:        ${uniqueDoc.length}`);
  console.log(`Doc duplicates dropped:   ${docDupes.length}${docDupes.length ? ` (${docDupes.join(', ')})` : ''}`);
  console.log(`Total waitlist entries:   ${waitlist.length}`);

  console.log(`\n✓ Already in waitlist DB (${inWaitlist.length}):`);
  inWaitlist.forEach((d) => {
    const w = waitlistMap.get(norm(d.email))!;
    console.log(`    ${d.email.padEnd(45)} → ${w.first_name} ${w.last_name} [${w.type}]`);
  });

  console.log(`\n✗ NOT in waitlist (${notInWaitlist.length}):`);
  notInWaitlist.forEach((d) => {
    console.log(`    ${d.email.padEnd(45)} → ${d.name}`);
  });

  if (alreadyOnPlatform.length) {
    console.log(`\n⚠ Already signed up on the platform (${alreadyOnPlatform.length}):`);
    alreadyOnPlatform.forEach((d) => {
      const u = userMap.get(norm(d.email))!;
      console.log(`    ${d.email.padEnd(45)} → ${u.name} [${u.role}]`);
    });
  }

  console.log('\n═════════════════════════════════════\n');
}

main()
  .catch((err) => {
    console.error('Check failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
