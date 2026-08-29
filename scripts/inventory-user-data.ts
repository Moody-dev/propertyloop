/**
 * Read-only: for a list of emails, walk every foreign key that points at
 * the users table and count the rows attached to each account, so a purge
 * plan can be reviewed before anything is deleted.
 *
 * Run: node -r ./scripts/_dns-fallback.js -r ts-node/register scripts/inventory-user-data.ts
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const emails = [
  'olaoluwaoyetibo2@gmail.com',
  'techpro.classy@gmail.com',
  'ifectone@gmail.com',
  'brosmoney40@gmail.com',
  'expertdavid45@gmail.com',
];

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
} as any);

type Fk = {
  child_table: string;
  child_column: string;
  parent_table: string;
  delete_rule: string;
};

async function main() {
  const users: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, email, name, role FROM "User" WHERE lower(email) = ANY($1::text[])`,
    emails.map((e) => e.toLowerCase()),
  );
  console.log(`Found ${users.length} of ${emails.length} accounts.\n`);

  // Every FK in the schema, so we can follow User → children → grandchildren.
  const fks: Fk[] = await prisma.$queryRawUnsafe(`
    SELECT tc.table_name  AS child_table,
           kcu.column_name AS child_column,
           ccu.table_name  AS parent_table,
           rc.delete_rule  AS delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name AND tc.table_schema = rc.constraint_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
  `);

  const userFks = fks.filter((f) => f.parent_table === 'User');

  for (const u of users) {
    console.log('═'.repeat(72));
    console.log(`${u.email}  —  ${u.name} (${u.role})  id=${u.id}`);
    console.log('─'.repeat(72));

    const restricted: string[] = [];
    const setNull: string[] = [];

    for (const f of userFks) {
      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT count(*)::int AS n FROM "${f.child_table}" WHERE "${f.child_column}" = $1`,
        u.id,
      );
      const n = rows[0]?.n ?? 0;
      if (!n) continue;
      const rule = f.delete_rule;
      console.log(
        `  ${f.child_table}.${f.child_column}`.padEnd(52) +
          `${String(n).padStart(5)}  [${rule}]`,
      );
      if (rule === 'NO ACTION' || rule === 'RESTRICT') restricted.push(`${f.child_table}.${f.child_column} (${n})`);
      if (rule === 'SET NULL') setNull.push(`${f.child_table}.${f.child_column} (${n})`);
    }

    // Second level: rows hanging off this user's listings / conversations,
    // which a cascade removes but which are worth seeing in the plan.
    const listingOwnerFk = userFks.find((f) => f.child_table === 'Listing');
    const listings: any[] = listingOwnerFk
      ? await prisma.$queryRawUnsafe(
          `SELECT id FROM "Listing" WHERE "${listingOwnerFk.child_column}" = $1`,
          u.id,
        )
      : [];
    if (listings.length) {
      const ids = listings.map((l) => l.id);
      for (const f of fks.filter((x) => x.parent_table === 'Listing')) {
        const rows: any[] = await prisma.$queryRawUnsafe(
          `SELECT count(*)::int AS n FROM "${f.child_table}" WHERE "${f.child_column}" = ANY($1::text[])`,
          ids,
        );
        const n = rows[0]?.n ?? 0;
        if (n) console.log(`  └─ ${f.child_table}.${f.child_column}`.padEnd(52) + `${String(n).padStart(5)}  [${f.delete_rule}]`);
      }
    }

    if (restricted.length) {
      console.log(`\n  ⚠ BLOCKS DELETE (restrict/no-action): ${restricted.join(', ')}`);
    }
    if (setNull.length) {
      console.log(`  ℹ survives as orphan row with null user: ${setNull.join(', ')}`);
    }
  }
  console.log('═'.repeat(72));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
