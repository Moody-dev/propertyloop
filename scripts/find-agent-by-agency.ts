import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
} as any);

async function main() {
  const needle = (process.argv[2] || '').toLowerCase();
  if (!needle) {
    console.error('Usage: npx ts-node scripts/find-agent-by-agency.ts <substring>');
    process.exit(1);
  }
  const users = await prisma.user.findMany({
    where: {
      role: 'AGENT',
      agentProfile: {
        agencyName: { contains: needle, mode: 'insensitive' },
      },
    },
    include: { agentProfile: true },
  });
  console.log(`Matches for "${needle}": ${users.length}`);
  users.forEach((u) => {
    console.log(
      `  • ${u.email}  | name=${u.name}  | agency=${u.agentProfile?.agencyName}  | verified=${u.agentProfile?.verified}  | listings=${u.agentProfile?.listingsCount}  | sold=${u.agentProfile?.soldRentedCount}`,
    );
  });
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
