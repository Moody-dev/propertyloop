/**
 * Generate pre-filled signup invite URLs for the 23 curated names from the
 * client's Google Doc.
 *
 * Output: scripts/output/curated-23-invites.csv with one row per recipient.
 * No emails are sent. Hand the CSV to whatever mailer you want when ready.
 *
 * Run with:  npx ts-node scripts/onboard-curated-23.ts
 *
 * Required env:
 *   DATABASE_URL                Postgres connection string
 *   WAITLIST_TOKEN_SECRET       JWT signing secret (must match the backend)
 *   FRONTEND_URL (optional)     Defaults to https://propertyloop.ng
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as jwt from 'jsonwebtoken';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const curated: { name: string; email: string }[] = [
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

const tokenSecret =
  process.env.WAITLIST_TOKEN_SECRET || 'wl-dev-secret-change-in-prod';
if (tokenSecret === 'wl-dev-secret-change-in-prod') {
  console.warn(
    '⚠ WAITLIST_TOKEN_SECRET is not set — using the dev fallback. The backend must be using the same secret for these tokens to verify.',
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

const norm = (e: string) => e.trim().toLowerCase();

function csvEscape(value: string | null | undefined): string {
  const v = value ?? '';
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

async function main() {
  // Case-insensitive lookup: load all waitlist entries (small set) and key
  // by lowercased email so casing differences in the curated list don't miss.
  const allEntries = await prisma.waitlistEntry.findMany();
  const byEmail = new Map(allEntries.map((e) => [norm(e.email), e]));

  const outDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'curated-23-invites.csv');

  const lines: string[] = [
    'email,doc_name,db_name,role,activated,invite_url,note',
  ];

  let issued = 0;
  let alreadyActivated = 0;
  let missing = 0;
  let skippedUnknownType = 0;

  for (const c of curated) {
    const key = norm(c.email);
    const entry = byEmail.get(key);

    if (!entry) {
      missing += 1;
      lines.push(
        [
          csvEscape(c.email),
          csvEscape(c.name),
          '',
          '',
          '',
          '',
          csvEscape('not in waitlist DB — skipped'),
        ].join(','),
      );
      continue;
    }

    if (entry.activated) {
      alreadyActivated += 1;
      lines.push(
        [
          csvEscape(c.email),
          csvEscape(c.name),
          csvEscape(`${entry.first_name} ${entry.last_name}`.trim()),
          csvEscape(typeToRole[entry.type] ?? entry.type),
          'true',
          '',
          csvEscape('already activated — no invite needed'),
        ].join(','),
      );
      continue;
    }

    const role = typeToRole[entry.type];
    if (!role) {
      skippedUnknownType += 1;
      lines.push(
        [
          csvEscape(c.email),
          csvEscape(c.name),
          csvEscape(`${entry.first_name} ${entry.last_name}`.trim()),
          csvEscape(entry.type),
          'false',
          '',
          csvEscape(`unknown type ${entry.type} — skipped`),
        ].join(','),
      );
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

    issued += 1;
    lines.push(
      [
        csvEscape(c.email),
        csvEscape(c.name),
        csvEscape(fullName),
        csvEscape(role),
        'false',
        csvEscape(url),
        '',
      ].join(','),
    );
  }

  fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');

  console.log('\n══════ CURATED-23 INVITE GENERATION ══════');
  console.log(`Total in curated list:    ${curated.length}`);
  console.log(`Invite URLs issued:       ${issued}`);
  console.log(`Already activated:        ${alreadyActivated}`);
  console.log(`Missing from waitlist DB: ${missing}`);
  console.log(`Skipped (unknown type):   ${skippedUnknownType}`);
  console.log(`Output:                   ${outPath}`);
  console.log(`Frontend base:            ${frontendUrl}`);
  console.log('═══════════════════════════════════════════\n');
}

main()
  .catch((err) => {
    console.error('Generation failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
