/** Read-only check: BlockedUser table + expanded ReportTargetType exist. */
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../generated/prisma/client';
import 'dotenv/config';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) } as any);

async function main() {
  const table = await prisma.$queryRawUnsafe<any[]>(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'BlockedUser' ORDER BY ordinal_position;`);
  console.log('BlockedUser columns:', table.map((r) => r.column_name));

  const enumVals = await prisma.$queryRawUnsafe<any[]>(`
    SELECT enumlabel FROM pg_enum
    WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'ReportTargetType')
    ORDER BY enumsortorder;`);
  console.log('ReportTargetType values:', enumVals.map((r) => r.enumlabel));

  const count = await prisma.blockedUser.count();
  console.log('Existing blocks:', count);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
