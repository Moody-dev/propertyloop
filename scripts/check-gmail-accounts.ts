/**
 * Checks a pasted list of email addresses against the platform:
 * User (real accounts), PartialSignup (abandoned signups),
 * AppWaitlistEntry and WaitlistEntry (mailing lists).
 *
 * Run with: npx ts-node scripts/check-gmail-accounts.ts
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import * as dns from 'node:dns';

const emails = [
  'brosmoney40@gmail.com',
  'olaoluwaoyetibo@gmail.com',
  'ooyetibo243481@stu.ui.edu.ng',
  'olaoluwaoyetibo2@gmail.com',
  'techpro.classy@gmail.com',
  'expertdavid45@gmail.com',
  'ifectone@gmail.com',
  'crossover893@gmail.com',
  'lattegirrlyy@gmail.com',
  'sholaoyetibo01@gmail.com',
];

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not set');

// This machine's resolver intermittently fails on the Supabase pooler
// hostname (EAI_AGAIN). Fall back to a public resolver and dial the IP
// directly, keeping TLS on (the pooler routes by username, not SNI).
async function buildConnection(): Promise<{ connectionString: string; ssl?: any }> {
  const url = new URL(databaseUrl!);
  try {
    await dns.promises.lookup(url.hostname);
    return { connectionString: databaseUrl! };
  } catch {
    const resolver = new dns.promises.Resolver();
    resolver.setServers(['8.8.8.8', '1.1.1.1']);
    const [ip] = await resolver.resolve4(url.hostname);
    console.log(`(resolved ${url.hostname} -> ${ip} via public DNS)`);
    const host = url.hostname;
    url.hostname = ip;
    return { connectionString: url.toString(), ssl: { rejectUnauthorized: false, servername: host } };
  }
}

let prisma: PrismaClient;

const norm = (e: string) => e.trim().toLowerCase();

async function main() {
  const adapter = new PrismaPg(await buildConnection() as any);
  prisma = new PrismaClient({ adapter } as any);
  const list = emails.map(norm);

  const [users, partials, appWaitlist, waitlist] = await Promise.all([
    prisma.user.findMany({
      where: { email: { in: list, mode: 'insensitive' } },
      select: {
        email: true, name: true, role: true, emailVerifiedAt: true,
        isActive: true, deletedAt: true, deactivatedAt: true,
        signupPlatform: true, createdAt: true,
      },
    }),
    prisma.partialSignup.findMany({
      where: { email: { in: list, mode: 'insensitive' } },
      select: { email: true, name: true, role: true, step: true, source: true, completedAt: true, createdAt: true },
    }),
    prisma.appWaitlistEntry.findMany({
      where: { email: { in: list, mode: 'insensitive' } },
      select: { email: true, source: true, createdAt: true },
    }),
    prisma.waitlistEntry.findMany({
      where: { email: { in: list, mode: 'insensitive' } },
      select: { email: true, first_name: true, last_name: true, type: true, activated: true, created_at: true },
    }),
  ]);

  const byEmail = <T extends { email: string }>(rows: T[]) =>
    new Map(rows.map((r) => [norm(r.email), r]));
  const uMap = byEmail(users);
  const pMap = byEmail(partials);
  const aMap = byEmail(appWaitlist);
  const wMap = byEmail(waitlist);

  console.log(`\nChecked ${list.length} addresses against the database.\n`);

  for (const e of list) {
    const u = uMap.get(e);
    const p = pMap.get(e);
    const a = aMap.get(e);
    const w = wMap.get(e);

    console.log('─'.repeat(70));
    console.log(e);

    if (u) {
      const flags = [
        u.emailVerifiedAt ? 'verified' : 'UNVERIFIED',
        u.isActive ? 'active' : 'SUSPENDED',
        u.deletedAt ? 'DELETED' : null,
        u.deactivatedAt ? 'DEACTIVATED' : null,
      ].filter(Boolean).join(', ');
      console.log(`  ACCOUNT: ${u.name} — ${u.role} [${flags}]`);
      console.log(`           signed up ${u.createdAt.toISOString().slice(0, 10)} via ${u.signupPlatform ?? 'unknown'}`);
    } else {
      console.log('  ACCOUNT: none');
    }

    if (p) console.log(`  partial signup: ${p.name ?? '—'} role=${p.role ?? '—'} step=${p.step ?? '—'} source=${p.source ?? '—'} ${p.completedAt ? '(completed)' : '(abandoned)'} ${p.createdAt.toISOString().slice(0, 10)}`);
    if (a) console.log(`  app waitlist: source=${a.source ?? '—'} ${a.createdAt.toISOString().slice(0, 10)}`);
    if (w) console.log(`  platform waitlist: ${w.first_name} ${w.last_name} — ${w.type} ${w.activated ? '(activated)' : '(not activated)'} ${w.created_at.toISOString().slice(0, 10)}`);
    if (!u && !p && !a && !w) console.log('  → not found anywhere');
  }

  console.log('─'.repeat(70));
  console.log(`\nSummary: ${uMap.size} with accounts, ${pMap.size} partial signups, ${aMap.size} app-waitlist, ${wMap.size} platform-waitlist, ${list.filter((e) => !uMap.has(e) && !pMap.has(e) && !aMap.has(e) && !wMap.has(e)).length} not found.\n`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma?.$disconnect());
