/** Read-only check: AgentProfile.licenseNumber is nullable + still unique. */
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../generated/prisma/client';
import 'dotenv/config';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) } as any);

async function main() {
  const col = await prisma.$queryRawUnsafe<any[]>(`
    SELECT is_nullable FROM information_schema.columns
    WHERE table_name = 'AgentProfile' AND column_name = 'licenseNumber';`);
  console.log('licenseNumber is_nullable:', col[0]?.is_nullable);

  const idx = await prisma.$queryRawUnsafe<any[]>(`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'AgentProfile' AND indexname = 'AgentProfile_licenseNumber_key';`);
  console.log('Unique index still present:', idx.length === 1);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
