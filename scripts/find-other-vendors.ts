import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
} as any);

async function main() {
  const vendors: any[] = await prisma.user.findMany({
    where: {
      role: 'VENDOR',
      deletedAt: null,
      vendorProfile: {
        is: {
          OR: [
            { serviceCategory: '' },
            { serviceCategory: { equals: 'Other', mode: 'insensitive' } },
          ],
        },
      },
    },
    include: { vendorProfile: true },
  });

  console.log(`Found ${vendors.length} vendor(s) with empty/"Other" category:\n`);
  for (const v of vendors) {
    console.log('  id              :', v.id);
    console.log('  name            :', v.name);
    console.log('  email           :', v.email);
    console.log('  serviceCategory :', JSON.stringify(v.vendorProfile?.serviceCategory));
    console.log('  isActive        :', v.isActive);
    console.log('  availableForHire:', v.vendorProfile?.availableForHire);
    console.log('');
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
