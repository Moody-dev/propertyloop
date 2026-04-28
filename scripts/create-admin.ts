/**
 * Create or promote a PropertyLoop admin user.
 *
 * Usage:
 *   npx ts-node scripts/create-admin.ts <email> <password> [name]
 *
 * If a user with that email already exists, their role is promoted to ADMIN
 * (the password is left untouched). Otherwise a new ADMIN user is created.
 */
import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Role } from '../generated/prisma/client';

async function main() {
  const [, , emailArg, passwordArg, nameArg] = process.argv;
  if (!emailArg || !passwordArg) {
    console.error('Usage: npx ts-node scripts/create-admin.ts <email> <password> [name]');
    process.exit(1);
  }

  const email = emailArg.trim().toLowerCase();
  const password = passwordArg;
  const name = nameArg?.trim() || 'Administrator';

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter } as any);

  try {
    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing) {
      if (existing.role === Role.ADMIN) {
        console.log(`✓ ${email} is already an ADMIN. No changes.`);
      } else {
        await prisma.user.update({
          where: { id: existing.id },
          data: { role: Role.ADMIN, isActive: true },
        });
        console.log(`✓ Promoted ${email} (was ${existing.role}) to ADMIN.`);
        console.log(`  Existing password is preserved.`);
      }
    } else {
      const passwordHash = await bcrypt.hash(password, 12);
      await prisma.user.create({
        data: {
          email,
          name,
          passwordHash,
          role: Role.ADMIN,
          emailVerifiedAt: new Date(),
          isActive: true,
        },
      });
      console.log(`✓ Created new ADMIN: ${email}`);
    }

    console.log('\nLog in at the admin app with:');
    console.log(`  email:    ${email}`);
    if (!existing) console.log(`  password: ${password}`);
    else console.log(`  password: (existing — was already in the DB)`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
