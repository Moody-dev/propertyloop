import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
} as any);

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error('Usage: npx ts-node scripts/check-vendor-portfolio.ts <vendorId>');
    process.exit(1);
  }

  const u: any = await prisma.user.findUnique({
    where: { id },
    include: { vendorProfile: true },
  });

  if (!u) {
    console.log('No user found for id:', id);
    return;
  }

  console.log('User:');
  console.log('  id              :', u.id);
  console.log('  email           :', u.email);
  console.log('  name            :', u.name);
  console.log('  role            :', u.role);
  console.log('  isActive        :', u.isActive);
  console.log('  deletedAt       :', u.deletedAt);
  console.log('');
  console.log('VendorProfile:');
  if (!u.vendorProfile) {
    console.log('  (none)');
  } else {
    console.log('  serviceCategory :', u.vendorProfile.serviceCategory);
    console.log('  bannerImage     :', u.vendorProfile.bannerImage);
    console.log('  portfolioImages :', JSON.stringify(u.vendorProfile.portfolioImages, null, 2));
    console.log('  verified        :', u.vendorProfile.verified);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
