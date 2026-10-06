/**
 * Provision a real marketplace vendor: a VENDOR user, their storefront, and a
 * first product — the same end state a vendor reaches by signing up and using
 * their dashboard, created here so an account is ready to log into.
 *
 * Idempotent: upserts on email and slug, so re-running only refreshes content.
 *
 * Run with:  npx ts-node scripts/provision-vendor.ts
 *
 * Env:
 *   DATABASE_URL / DIRECT_URL     Postgres connection
 *   PROVISION_EMAIL (optional)    Vendor email (default olaoluwaoyetibo01@gmail.com)
 *   PROVISION_PASSWORD (optional) Login password (default "Vendor2026!")
 */
import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL or DIRECT_URL is required.');
  process.exit(1);
}
const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter } as any);

const EMAIL = (
  process.env.PROVISION_EMAIL || 'olaoluwaoyetibo01@gmail.com'
).toLowerCase();
const PASSWORD = process.env.PROVISION_PASSWORD || 'Vendor2026!';
const NAME = 'Olaoluwa Oyetibo';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function referralCode(): string {
  let c = '';
  for (let i = 0; i < 8; i++)
    c += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return c;
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'store'
  );
}

async function uniqueStoreSlug(base: string): Promise<string> {
  let slug = base;
  let i = 1;
  // Reuse the slug if it already belongs to this owner (idempotent re-runs).
  while (true) {
    const existing = await prisma.marketplaceStore.findUnique({
      where: { slug },
    });
    if (!existing) return slug;
    const owner = await prisma.user.findUnique({ where: { email: EMAIL } });
    if (owner && existing.ownerUserId === owner.id) return slug;
    i += 1;
    slug = `${base}-${i}`;
  }
}

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  // 1. Vendor user
  let user = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: EMAIL,
        passwordHash,
        name: NAME,
        role: 'VENDOR',
        location: 'Lagos, Nigeria',
        emailVerifiedAt: new Date(),
        referralCode: referralCode(),
      },
    });
    console.log(`created vendor user ${EMAIL}`);
  } else {
    // Make sure the existing account can act as a marketplace vendor.
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        role: 'VENDOR',
        emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
      },
    });
    console.log(`vendor user ${EMAIL} already existed — ensured VENDOR role`);
  }

  // 2. VendorProfile (required for the account to behave as a vendor)
  await prisma.vendorProfile.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      serviceCategory: 'Furniture & Interiors',
      yearsExperience: 'New vendor',
      serviceArea: 'Lagos',
    },
    update: {},
  });

  // 3. Storefront
  const storeName = 'Olaoluwa Home';
  const slug = await uniqueStoreSlug(slugify(storeName));
  const store = await prisma.marketplaceStore.upsert({
    where: { slug },
    create: {
      slug,
      ownerUserId: user.id,
      name: storeName,
      tagline: 'Modern furniture and decor for Lagos homes.',
      bio: 'A new storefront on PropertyLoop. Edit this from your vendor dashboard — add your logo, banner, story, delivery areas and products.',
      logo: 'https://images.unsplash.com/photo-1618220179428-22790b461013?w=400&h=400&fit=crop',
      banner:
        'https://images.unsplash.com/photo-1540574163026-643ea20ade25?w=1600&h=800&fit=crop',
      accent: '#2b4e3b',
      category: 'Furniture & Interiors',
      location: 'Lagos, Nigeria',
      phone: '',
      email: EMAIL,
      established: String(new Date().getFullYear()),
      verified: false,
      responseTime: 'within a day',
      deliveryAreas: ['Lagos', 'Nationwide'],
      policies: [
        {
          icon: 'truck',
          label: 'Lagos delivery',
          detail: 'Delivered within a few days',
        },
        {
          icon: 'shield',
          label: 'Buyer protection',
          detail: 'Secured by PropertyLoop',
        },
      ],
      collections: [],
    },
    update: {},
  });
  console.log(`store ready: /store/${store.slug}`);

  // 4. First product
  const productSlug = `${slug}-barcelona-lounge-chair`;
  await prisma.marketplaceProduct.upsert({
    where: { slug: productSlug },
    create: {
      storeId: store.id,
      slug: productSlug,
      name: 'Barcelona Lounge Chair',
      description:
        'A leather lounge chair on a polished steel frame — a clean, modern accent piece for living rooms and reception areas. Delivered assembled.',
      priceNaira: 240000,
      compareAtNaira: 290000,
      category: 'Living Room',
      coverImage:
        'https://images.unsplash.com/photo-1540574163026-643ea20ade25?w=800&h=800&fit=crop',
      gallery: [
        'https://images.unsplash.com/photo-1540574163026-643ea20ade25?w=1000&h=1000&fit=crop',
        'https://images.unsplash.com/photo-1567538096630-e0c55bd6374c?w=1000&h=1000&fit=crop',
      ],
      specs: [
        { label: 'Material', value: 'Full-grain leather + steel' },
        { label: 'Dimensions', value: '75 × 70 × 78 cm' },
        { label: 'Delivery', value: 'Assembled, 3-5 days in Lagos' },
      ],
      options: [{ label: 'Colour', values: ['Tan', 'Black'] }],
      tag: 'sale',
      rating: 0,
      reviewsCount: 0,
      inStock: true,
    },
    update: {},
  });
  console.log('first product ready: Barcelona Lounge Chair');

  console.log('\n✅ Vendor provisioned.');
  console.log(`   Login:    ${EMAIL}`);
  console.log(`   Password: ${PASSWORD}`);
  console.log(`   Store:    /store/${store.slug}`);
  console.log('   Dashboard: /marketplace/vendor (after sign-in)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
