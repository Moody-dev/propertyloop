/**
 * Quick preview: who would receive a "send-to-all-agents" email?
 * Same WHERE clause as send-agent-add-property-guide.ts
 */
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) } as any);

async function main() {
  const agents = await prisma.user.findMany({
    where: { role: 'AGENT', isActive: true, deletedAt: null },
    select: { email: true, name: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Recipients (${agents.length}):\n`);
  agents.forEach((a, i) => {
    const joined = a.createdAt.toISOString().split('T')[0];
    console.log(
      `  ${String(i + 1).padStart(2, ' ')}. ${a.email.padEnd(40)} ${a.name ?? '(no name)'}   joined ${joined}`,
    );
  });

  await prisma.$disconnect();
  await pool.end();
}

main();
