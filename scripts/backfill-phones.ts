/**
 * One-shot backfill: normalize existing phone strings to E.164 (+234...).
 *
 *   npx ts-node scripts/backfill-phones.ts            # dry run, prints a report
 *   npx ts-node scripts/backfill-phones.ts --apply    # writes the changes
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../generated/prisma/client';
import { normalizePhone } from '../src/common/phone';
import 'dotenv/config';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL environment variable is not set');
}
const pool = new Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

const apply = process.argv.includes('--apply');

type TableStats = {
  table: string;
  scanned: number;
  alreadyValid: number;
  normalized: number;
  unfixable: { id: string; phone: string }[];
};

async function backfill<T extends { id: string; phone: string | null }>(
  table: string,
  rows: T[],
  update: (id: string, phone: string) => Promise<unknown>,
): Promise<TableStats> {
  const stats: TableStats = {
    table,
    scanned: rows.length,
    alreadyValid: 0,
    normalized: 0,
    unfixable: [],
  };

  for (const row of rows) {
    const current = row.phone ?? '';
    let normalized = normalizePhone(current);
    if (!normalized && current) {
      // Try splitting on common separators (commas, slashes, "and", whitespace
      // gaps with periods) and keep the first chunk that parses.
      const chunks = current.split(/[,/]|\s+and\s+|\s+\.\s+|;|\|/i);
      for (const chunk of chunks) {
        const candidate = normalizePhone(chunk);
        if (candidate) {
          normalized = candidate;
          break;
        }
      }
    }
    if (!normalized) {
      if (current) stats.unfixable.push({ id: row.id, phone: current });
      continue;
    }
    if (normalized === current) {
      stats.alreadyValid++;
      continue;
    }
    stats.normalized++;
    if (apply) await update(row.id, normalized);
  }

  return stats;
}

async function main() {
  console.log(apply ? '── APPLYING ──' : '── DRY RUN (pass --apply to write) ──');

  const results: TableStats[] = [];

  const users = await prisma.user.findMany({ select: { id: true, phone: true } });
  results.push(
    await backfill('User', users, (id, phone) =>
      prisma.user.update({ where: { id }, data: { phone } }),
    ),
  );

  const leads = await prisma.lead.findMany({ select: { id: true, phone: true } });
  results.push(
    await backfill('Lead', leads, (id, phone) =>
      prisma.lead.update({ where: { id }, data: { phone } }),
    ),
  );

  const orders = await prisma.order.findMany({ select: { id: true, phone: true } });
  results.push(
    await backfill('Order', orders, (id, phone) =>
      prisma.order.update({ where: { id }, data: { phone } }),
    ),
  );

  const waitlist = await prisma.waitlistEntry.findMany({
    select: { id: true, phone: true },
  });
  results.push(
    await backfill('WaitlistEntry', waitlist, (id, phone) =>
      prisma.waitlistEntry.update({ where: { id }, data: { phone } }),
    ),
  );

  const products = await prisma.product.findMany({
    select: { id: true, phone: true },
  });
  results.push(
    await backfill('Product', products, (id, phone) =>
      prisma.product.update({ where: { id }, data: { phone } }),
    ),
  );

  console.log();
  for (const s of results) {
    console.log(
      `${s.table.padEnd(15)} scanned=${s.scanned}  already-E164=${s.alreadyValid}  ` +
        `normalized=${s.normalized}  unfixable=${s.unfixable.length}`,
    );
    for (const u of s.unfixable) {
      console.log(`    ! ${s.table} ${u.id}  "${u.phone}"`);
    }
  }
  console.log();
  console.log(apply ? '── DONE ──' : '── DRY RUN COMPLETE — pass --apply to write ──');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
