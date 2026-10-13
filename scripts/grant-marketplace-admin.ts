/**
 * Grant a staff member the MANAGE_MARKETPLACE permission — the marketplace
 * admin (verify stores, set commission, oversee orders, resolve refunds and
 * disputes).
 *
 * Usage:
 *   npx ts-node scripts/grant-marketplace-admin.ts olaoluwaoyetibo@gmail.com
 *
 * Defaults to Olaoluwa's address when run with no argument. Idempotent: if the
 * person already holds the permission it reports that and changes nothing. The
 * person must already have a staff profile (be on the team portal).
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, StaffPermission } from '../generated/prisma/client';

const DEFAULT_EMAIL = 'olaoluwaoyetibo@gmail.com';

async function main() {
  const email = (process.argv[2] || DEFAULT_EMAIL).trim().toLowerCase();

  const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter } as any);

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      include: { staffProfile: true },
    });
    if (!user) throw new Error(`No user with email ${email}`);
    if (!user.staffProfile) {
      throw new Error(
        `${email} has no staff profile — add them to the team portal first.`,
      );
    }

    const current = user.staffProfile.permissions;
    if (current.includes(StaffPermission.MANAGE_MARKETPLACE)) {
      console.log(
        `✓ ${user.name} (${email}) already has MANAGE_MARKETPLACE — nothing to do.`,
      );
      return;
    }

    await prisma.staffProfile.update({
      where: { id: user.staffProfile.id },
      data: {
        permissions: { set: [...current, StaffPermission.MANAGE_MARKETPLACE] },
      },
    });

    console.log(
      `✓ Granted MANAGE_MARKETPLACE to ${user.name} (${email}).\n` +
        `  They can now open the Marketplace section in the team portal.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
