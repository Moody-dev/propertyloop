/**
 * Preview: REAL_ESTATE_AGENT waitlist entries who have NOT yet signed up
 * (no matching User row by email, case-insensitive).
 *
 * Usage:  npx ts-node scripts/list-pending-agents.ts
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not set');
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
} as any);

async function main() {
  const [waitlistAgents, users] = await Promise.all([
    prisma.waitlistEntry.findMany({
      where: { type: 'REAL_ESTATE_AGENT' },
      orderBy: { created_at: 'asc' },
    }),
    prisma.user.findMany({
      select: { email: true },
      where: { deletedAt: null },
    }),
  ]);

  const signedUpEmails = new Set(
    users.map((u) => u.email.trim().toLowerCase()),
  );

  const pending = waitlistAgents.filter(
    (w) => !signedUpEmails.has(w.email.trim().toLowerCase()),
  );
  const alreadySignedUp = waitlistAgents.length - pending.length;

  console.log(`Total real-estate-agent waitlist entries : ${waitlistAgents.length}`);
  console.log(`Already signed up (excluded)             : ${alreadySignedUp}`);
  console.log(`Pending (will receive onboarding)        : ${pending.length}\n`);

  pending.forEach((w, i) => {
    const name = `${w.first_name ?? ''} ${w.last_name ?? ''}`.trim() || '(no name)';
    const joined = w.created_at.toISOString().split('T')[0];
    console.log(
      `  ${String(i + 1).padStart(3, ' ')}. ${w.email.padEnd(40)} ${name.padEnd(28)} joined ${joined}`,
    );
  });

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
