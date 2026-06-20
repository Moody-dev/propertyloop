import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
} as any);

async function main() {
  const id = process.argv[2];
  const category = process.argv[3];
  if (!id || !category) {
    console.error(
      'Usage: npx ts-node scripts/update-vendor-category.ts <vendorUserId> "<Category>"',
    );
    process.exit(1);
  }

  const before: any = await prisma.user.findUnique({
    where: { id },
    include: { vendorProfile: true },
  });
  if (!before?.vendorProfile) {
    console.log('No vendor profile found for id:', id);
    return;
  }

  console.log('Before:', before.name, '->', JSON.stringify(before.vendorProfile.serviceCategory));

  const updated = await prisma.vendorProfile.update({
    where: { userId: id },
    data: { serviceCategory: category },
  });

  console.log('After :', before.name, '->', JSON.stringify(updated.serviceCategory));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
