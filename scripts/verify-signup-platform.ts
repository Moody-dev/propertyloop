/** Read-only check: User.signupPlatform column exists and is queryable. */
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../generated/prisma/client';
import 'dotenv/config';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) } as any);

async function main() {
  const col = await prisma.$queryRawUnsafe<any[]>(`
    SELECT column_name, is_nullable FROM information_schema.columns
    WHERE table_name = 'User' AND column_name = 'signupPlatform';`);
  console.log('signupPlatform column:', col);

  const counts = await prisma.user.groupBy({
    by: ['signupPlatform'],
    _count: true,
  });
  console.log('Existing users by signupPlatform (all null pre-migration, expected):', counts);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
