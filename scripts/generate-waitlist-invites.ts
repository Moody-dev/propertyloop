/**
 * Generates pre-filled signup links for every waitlist entry.
 *
 *   For each WaitlistEntry we sign a 90-day JWT with name/email/phone/role
 *   and emit a URL of the form:  <FRONTEND_URL>/onboarding?wl=<token>
 *
 *   No emails are sent. The output is written to scripts/output/waitlist-invites.csv
 *   so you can paste the rows into a mailing tool (or eyeball them) yourself.
 *
 * Run with:  npx ts-node scripts/generate-waitlist-invites.ts
 *
 * Required env:
 *   - DATABASE_URL                Postgres connection string
 *   - WAITLIST_TOKEN_SECRET       JWT signing secret (must match the backend)
 *   - FRONTEND_URL (optional)     Defaults to https://propertyloop.ng
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as jwt from 'jsonwebtoken';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not set');

const tokenSecret =
  process.env.WAITLIST_TOKEN_SECRET || 'wl-dev-secret-change-in-prod';
if (tokenSecret === 'wl-dev-secret-change-in-prod') {
  console.warn(
    '⚠ WAITLIST_TOKEN_SECRET is not set — using the dev fallback. Tokens generated now will only work against a backend using the same fallback.',
  );
}

const frontendUrl = (process.env.FRONTEND_URL || 'https://propertyloop.ng').replace(/\/+$/, '');

const typeToRole: Record<string, string> = {
  REAL_ESTATE_AGENT: 'agent',
  BUILDER: 'vendor',
  BUILDING_MATERIALS_SUPPLIER_INSTALLER: 'vendor',
  PARTNER_INVESTOR: 'buyer',
};

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter } as any);

function csvEscape(value: string | null | undefined): string {
  const v = value ?? '';
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

async function main() {
  const entries = await prisma.waitlistEntry.findMany({
    orderBy: { created_at: 'asc' },
  });

  const outDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'waitlist-invites.csv');

  const lines: string[] = [
    'email,name,role,activated,invite_url',
  ];

  let activatedCount = 0;
  let skippedCount = 0;

  for (const entry of entries) {
    if (entry.activated) {
      activatedCount += 1;
      continue;
    }

    const role = typeToRole[entry.type];
    if (!role) {
      console.warn(`Skipping ${entry.email} — unknown type ${entry.type}`);
      skippedCount += 1;
      continue;
    }

    const fullName = `${entry.first_name} ${entry.last_name}`.trim();
    const token = jwt.sign(
      {
        wlId: entry.id,
        name: fullName,
        email: entry.email,
        phone: entry.phone,
        location: entry.location ?? '',
        role,
      },
      tokenSecret,
      { expiresIn: '90d' },
    );

    const url = `${frontendUrl}/onboarding?wl=${token}`;

    lines.push(
      [
        csvEscape(entry.email),
        csvEscape(fullName),
        csvEscape(role),
        csvEscape(String(entry.activated)),
        csvEscape(url),
      ].join(','),
    );
  }

  fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');

  console.log('\n══════ WAITLIST INVITE GENERATION ══════');
  console.log(`Total waitlist entries:   ${entries.length}`);
  console.log(`Already activated:        ${activatedCount}`);
  console.log(`Skipped (unknown type):   ${skippedCount}`);
  console.log(`Invite URLs written:      ${lines.length - 1}`);
  console.log(`Output:                   ${outPath}`);
  console.log(`Frontend base:            ${frontendUrl}`);
  console.log('═════════════════════════════════════════\n');
}

main()
  .catch((err) => {
    console.error('Generation failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
