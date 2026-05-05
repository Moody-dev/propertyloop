import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
} as any);

async function main() {
  // Waitlist breakdown by type
  const wlByType = await prisma.waitlistEntry.groupBy({
    by: ['type', 'activated'],
    _count: { _all: true },
  });

  // Registered users by role
  const userByRole = await prisma.user.groupBy({
    by: ['role'],
    where: { isActive: true, deletedAt: null },
    _count: { _all: true },
  });

  console.log('── Waitlist (by type · activated) ──');
  wlByType
    .sort((a, b) => a.type.localeCompare(b.type))
    .forEach((r) =>
      console.log(
        `  ${r.type.padEnd(40)}  activated=${String(r.activated).padEnd(5)}  count=${r._count._all}`,
      ),
    );

  console.log('\n── Registered users (active, role) ──');
  userByRole.forEach((r) =>
    console.log(`  ${r.role.padEnd(10)}  count=${r._count._all}`),
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
