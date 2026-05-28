import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

async function main() {
  const [, , emailArg, passwordArg] = process.argv;
  if (!emailArg || !passwordArg) {
    console.error('Usage: npx ts-node scripts/reset-admin-password.ts <email> <newPassword>');
    process.exit(1);
  }

  const email = emailArg.trim().toLowerCase();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter } as any);

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      console.error(`No user found with email ${email}`);
      process.exit(1);
    }
    const passwordHash = await bcrypt.hash(passwordArg, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });
    console.log(`Password reset for ${email}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
