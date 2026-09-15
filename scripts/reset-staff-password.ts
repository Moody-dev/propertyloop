/**
 * Give one staff member a new temporary password.
 *
 * Usage:
 *   npx ts-node scripts/reset-staff-password.ts someone@propertyloop.ng
 *
 * The same thing the portal's Team → Edit position → Reset password does,
 * for when nobody who can reach that screen is signed in. Changes the
 * password only — position, permissions and history are untouched — and ends
 * every session the person has, so a device signed in with the old password
 * does not stay in.
 *
 * The new password is printed once and never stored readably.
 */
import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { generatePassword } from '../src/staff/staff-accounts';

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error('Usage: npx ts-node scripts/reset-staff-password.ts <email>');
    process.exit(1);
  }

  const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  } as any);

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        name: true,
        isActive: true,
        deletedAt: true,
        staffProfile: { select: { active: true, staffRole: true } },
      },
    });
    if (!user) throw new Error(`No account for ${email}`);
    if (!user.staffProfile) {
      throw new Error(`${email} is not a staff account — refusing to touch it`);
    }

    const password = generatePassword();
    const passwordHash = await bcrypt.hash(password, 12);
    const now = new Date();

    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: now },
      }),
      prisma.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);

    // Read the hash back and check it, rather than trusting the write.
    const stored = await prisma.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true },
    });
    const verified =
      !!stored && (await bcrypt.compare(password, stored.passwordHash));

    console.log(`\n  ${user.name} <${email}> · ${user.staffProfile.staffRole}`);
    console.log(`  New password : ${password}`);
    console.log(`  Stored hash matches : ${verified ? 'yes' : 'NO'}`);
    // Anything below would still block sign-in, whatever the password.
    if (user.deletedAt) console.log('  ! Account is closed (deletedAt set)');
    if (!user.isActive) console.log('  ! Account is inactive');
    if (!user.staffProfile.active) {
      console.log('  ! Staff access is deactivated in the portal');
    }
    console.log('  All previous sessions have been signed out.\n');
    if (!verified) process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
