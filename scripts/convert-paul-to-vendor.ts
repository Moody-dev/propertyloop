/**
 * One-off: convert paulukbrand@gmail.com from AGENT → VENDOR (light fittings).
 *
 * Usage:
 *   npx ts-node scripts/convert-paul-to-vendor.ts            # dry-run
 *   npx ts-node scripts/convert-paul-to-vendor.ts --confirm  # execute
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Role } from '../generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
} as any);

const EMAIL = 'paulukbrand@gmail.com';
const SERVICE_CATEGORY = 'Light Fittings';
const DEFAULT_SERVICE_AREA = 'Lagos';
const DEFAULT_YEARS_EXPERIENCE = '0';

async function main() {
  const confirm = process.argv.includes('--confirm');

  const user = await prisma.user.findUnique({
    where: { email: EMAIL },
    include: { agentProfile: true, vendorProfile: true },
  });

  if (!user) {
    console.error(`No user found for ${EMAIL}.`);
    process.exit(1);
  }

  console.log('Current state');
  console.log(`  email:         ${user.email}`);
  console.log(`  name:          ${user.name}`);
  console.log(`  role:          ${user.role}`);
  console.log(`  location:      ${user.location ?? '(none)'}`);
  console.log(`  agentProfile:  ${user.agentProfile ? `agency="${user.agentProfile.agencyName}" listings=${user.agentProfile.listingsCount}` : '(none)'}`);
  console.log(`  vendorProfile: ${user.vendorProfile ? `category="${user.vendorProfile.serviceCategory}"` : '(none)'}`);

  if (user.role === Role.VENDOR && user.vendorProfile) {
    console.log('\nAlready a vendor — nothing to do.');
    await prisma.$disconnect();
    return;
  }

  const serviceArea = user.location?.trim() || DEFAULT_SERVICE_AREA;

  console.log('\nPlanned changes');
  console.log('  1. Delete AgentProfile (he has no listings — safe)');
  console.log(`  2. User.role: AGENT → VENDOR`);
  console.log('  3. Create VendorProfile:');
  console.log(`        serviceCategory:  "${SERVICE_CATEGORY}"`);
  console.log(`        serviceArea:      "${serviceArea}"`);
  console.log(`        yearsExperience:  "${DEFAULT_YEARS_EXPERIENCE}"`);
  console.log(`        verified:         false (he can be verified separately)`);

  if (!confirm) {
    console.log('\n▶ Dry-run only. Re-run with --confirm to execute.');
    await prisma.$disconnect();
    return;
  }

  console.log('\n🔥 Executing...');

  await prisma.$transaction(async (tx) => {
    if (user.agentProfile) {
      await tx.agentProfile.delete({ where: { userId: user.id } });
      console.log('  ✓ AgentProfile deleted');
    }

    await tx.user.update({
      where: { id: user.id },
      data: { role: Role.VENDOR },
    });
    console.log('  ✓ User.role → VENDOR');

    await tx.vendorProfile.create({
      data: {
        userId: user.id,
        serviceCategory: SERVICE_CATEGORY,
        yearsExperience: DEFAULT_YEARS_EXPERIENCE,
        serviceArea,
        availableForHire: true,
      },
    });
    console.log('  ✓ VendorProfile created');
  });

  console.log('\n✓ Conversion complete.');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
