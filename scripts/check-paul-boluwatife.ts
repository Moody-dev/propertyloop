import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
} as any);

async function main() {
  const candidates = [
    { label: 'Paul Ubah', emails: ['paulukbrand@gmail.com', 'Paulukbrand@gmail.com'] },
    { label: 'Boluwatife Daniels', emails: ['danielsboluwatife@gmail.com'] },
  ];

  for (const c of candidates) {
    console.log(`\n── ${c.label} ──`);
    let found = false;
    for (const email of c.emails) {
      const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
        include: { agentProfile: true },
      });
      if (user) {
        found = true;
        console.log(`  ✓ User row: ${email.toLowerCase()}`);
        console.log(`    role=${user.role} isActive=${user.isActive} emailVerified=${!!user.emailVerifiedAt} createdAt=${user.createdAt.toISOString()}`);
        if (user.agentProfile) {
          console.log(`    agentProfile: verified=${user.agentProfile.verified} listings=${user.agentProfile.listingsCount} sold=${user.agentProfile.soldRentedCount} agency=${user.agentProfile.agencyName}`);
        } else {
          console.log(`    agentProfile: (none)`);
        }
        break;
      }
    }
    if (!found) {
      console.log(`  ✗ no User row for any of: ${c.emails.join(', ')}`);
    }

    // Also check waitlist
    for (const email of c.emails) {
      const wl = await prisma.waitlistEntry.findFirst({
        where: { email: email.toLowerCase() },
      });
      if (wl) {
        console.log(`    waitlist: id=${wl.id} type=${wl.type} activated=${wl.activated} created=${wl.created_at.toISOString().split('T')[0]}`);
        break;
      }
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
