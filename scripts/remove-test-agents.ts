/**
 * One-shot: soft-delete the "Test Paystackk" / "Test PayStack" test agents.
 *
 *   npx ts-node scripts/remove-test-agents.ts          # dry run, shows matches
 *   npx ts-node scripts/remove-test-agents.ts --apply  # soft-deletes them
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../generated/prisma/client';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not set');

const pool = new Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

const apply = process.argv.includes('--apply');

const NAME_PATTERNS = ['Test Paystackk', 'Test PayStack'];

async function main() {
  console.log(apply ? '── APPLYING ──' : '── DRY RUN (pass --apply to remove) ──');

  const matches = await prisma.user.findMany({
    where: {
      role: 'AGENT',
      deletedAt: null,
      OR: NAME_PATTERNS.map((n) => ({
        name: { equals: n, mode: 'insensitive' as const },
      })),
    },
    select: {
      id: true,
      name: true,
      email: true,
      agentProfile: { select: { agencyName: true } },
    },
  });

  if (matches.length === 0) {
    console.log('No matching test agents found.');
    return;
  }

  console.log(`Found ${matches.length} test agent(s):`);
  for (const u of matches) {
    console.log(
      `  - ${u.id}  ${u.name}  <${u.email}>  agency=${u.agentProfile?.agencyName ?? 'n/a'}`,
    );
  }

  if (!apply) {
    console.log('\nDry run — pass --apply to soft-delete (sets deletedAt + isActive=false).');
    return;
  }

  const now = new Date();
  for (const u of matches) {
    await prisma.user.update({
      where: { id: u.id },
      data: { deletedAt: now, isActive: false },
    });
    console.log(`  ✓ removed ${u.id} ${u.name}`);
  }
  console.log('── DONE ──');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
