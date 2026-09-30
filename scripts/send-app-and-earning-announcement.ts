/**
 * One-off announcement to everyone with a PropertyLoop account.
 *
 * Three versions of the same news, because the same sentence does not suit
 * everybody:
 *   AGENT   the earning news in full, with the PropertyLoop stock now live
 *   VENDOR  the app news, and how an introduction can earn
 *   BUYER   the app news, and that PropertyLoop now lists its own property
 *
 * Usage:
 *   npx ts-node scripts/send-app-and-earning-announcement.ts --dry
 *   npx ts-node scripts/send-app-and-earning-announcement.ts --sample
 *   npx ts-node scripts/send-app-and-earning-announcement.ts --sample someone@example.com
 *   npx ts-node scripts/send-app-and-earning-announcement.ts --send
 *   npx ts-node scripts/send-app-and-earning-announcement.ts --send --only=AGENT
 *
 * --send is required to email real people. Without it the script only counts.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Resend } from 'resend';
import { PrismaClient, Role } from '../generated/prisma/client';
import {
  SITE_URL,
  firstName,
  propertyCard,
  propertyLines,
  shell,
} from '../src/stock-alerts/stock-email';
import type { StockProperty } from '../src/stock-alerts/stock-email';

const GAP_MS = 600;

/** Where a preview goes when --sample names no address. */
const DEFAULT_SAMPLE_TO = 'olaoluwaoyetibo@gmail.com';

/* ─── The email ─────────────────────────────────────────────────────────── */

const APP_PARAGRAPH = `
  <div class="section-label">First, the app</div>
  <p class="body-text">
    We have shipped a lot into the PropertyLoop app recently. If you have not
    updated in a while, open the App Store or Play Store and update
    PropertyLoop. If you are already up to date, just open the app — the newest
    version loads on its own.
  </p>`;

const APP_TEXT = [
  'First, the app.',
  'We have shipped a lot into the PropertyLoop app recently. If you have not updated in a while, open the App Store or Play Store and update PropertyLoop. If you are already up to date, just open the app — the newest version loads on its own.',
].join('\n');

function agentEmail(name: string | null, property: StockProperty | null) {
  const who = firstName(name);
  const subject =
    'Update the app — and a new way to earn on PropertyLoop stock';
  const html = shell(
    subject,
    `
      <div class="greeting">Hi ${who},</div>
      <p class="body-text">
        Two things worth two minutes: the app has moved on since you last opened
        it, and there is now a way to earn on property you do not have the
        mandate for.
      </p>
      ${APP_PARAGRAPH}
      <div class="section-label">Now, the earning</div>
      <p class="body-text">
        PropertyLoop now lists its own stock, and it is open to you. Introduce a
        buyer who closes on one of our properties and you earn
        <strong>commission on the sale</strong>, agreed with you on the
        property — no mandate, no
        listing of your own, no fee to take part.
      </p>
      ${property ? `<div class="section-label">Live now</div>${propertyCard(property)}` : ''}
      <ol class="steps">
        <li>Register once at <a href="${SITE_URL}/realtors/partners">propertyloop.ng/realtors/partners</a>.</li>
        <li>Open <strong>PL stock</strong> in the app, or PropertyLoop stock in your agent dashboard.</li>
        <li>Share a property with a buyer you already know.</li>
        <li>Log the introduction before the viewing, so the buyer is attributed to you.</li>
      </ol>
      <p>
        <a class="btn" href="${SITE_URL}/realtors/partners">Join the partner programme</a>
        <a class="btn-secondary" href="${SITE_URL}/agent-dashboard/stock">See PropertyLoop stock</a>
      </p>
      <p class="note">
        From now on you will get an email each time we list a new PropertyLoop
        property, so you hear about the inventory when it goes live rather than
        after it is gone.
      </p>
    `,
  );
  const text = [
    `Hi ${who},`,
    '',
    'Two things worth two minutes: the app has moved on since you last opened it, and there is now a way to earn on property you do not have the mandate for.',
    '',
    APP_TEXT,
    '',
    'Now, the earning.',
    'PropertyLoop now lists its own stock, and it is open to you. Introduce a buyer who closes on one of our properties and you earn commission on the sale, agreed with you on the property — no mandate, no listing of your own, no fee to take part.',
    ...(property ? ['', 'Live now:', propertyLines(property)] : []),
    '',
    `1. Register once at ${SITE_URL}/realtors/partners`,
    '2. Open PL stock in the app, or PropertyLoop stock in your agent dashboard.',
    '3. Share a property with a buyer you already know.',
    '4. Log the introduction before the viewing, so the buyer is attributed to you.',
    '',
    'From now on you will get an email each time we list a new PropertyLoop property.',
    '',
    'You are receiving this because you have a PropertyLoop account. To stop emails like this, reply with the word UNSUBSCRIBE.',
  ].join('\n');
  return { subject, html, text };
}

function vendorEmail(name: string | null) {
  const who = firstName(name);
  const subject =
    'Update the PropertyLoop app — and a way to earn on an introduction';
  const html = shell(
    subject,
    `
      <div class="greeting">Hi ${who},</div>
      <p class="body-text">
        A quick note on two things: the app has moved on since you last opened
        it, and there is now a way to earn from the people you already know.
      </p>
      ${APP_PARAGRAPH}
      <div class="section-label">A way to earn</div>
      <p class="body-text">
        PropertyLoop now lists property of its own, and pays
        <strong>commission</strong> on an introduction
        that closes. If you know someone looking to buy, that introduction is
        worth money to you — registration is free and takes a minute.
      </p>
      <p>
        <a class="btn" href="${SITE_URL}/realtors/partners">See how it works</a>
        <a class="btn-secondary" href="${SITE_URL}">Browse properties</a>
      </p>
      <p class="note">
        Your vendor account, jobs and earnings are unchanged. This is simply
        another way to earn alongside them.
      </p>
    `,
  );
  const text = [
    `Hi ${who},`,
    '',
    'A quick note on two things: the app has moved on since you last opened it, and there is now a way to earn from the people you already know.',
    '',
    APP_TEXT,
    '',
    'PropertyLoop now lists property of its own, and pays commission on an introduction that closes. If you know someone looking to buy, that introduction is worth money to you — registration is free and takes a minute.',
    '',
    `How it works: ${SITE_URL}/realtors/partners`,
    '',
    'Your vendor account, jobs and earnings are unchanged.',
    '',
    'You are receiving this because you have a PropertyLoop account. To stop emails like this, reply with the word UNSUBSCRIBE.',
  ].join('\n');
  return { subject, html, text };
}

function buyerEmail(name: string | null, property: StockProperty | null) {
  const who = firstName(name);
  const subject = 'Update the PropertyLoop app — and see our own listings';
  const html = shell(
    subject,
    `
      <div class="greeting">Hi ${who},</div>
      <p class="body-text">
        Two things worth knowing: the app has moved on since you last opened it,
        and PropertyLoop now lists property of its own.
      </p>
      ${APP_PARAGRAPH}
      <div class="section-label">PropertyLoop stock</div>
      <p class="body-text">
        These are properties we list ourselves, verified by our team rather than
        forwarded from an agent. You will find them under
        <strong>PL stock</strong> on the app's home screen.
      </p>
      ${property ? propertyCard(property) : ''}
      <p>
        <a class="btn" href="${property ? `${SITE_URL}/property/${property.id}` : SITE_URL}">${property ? 'View the property' : 'Browse properties'}</a>
      </p>
      <p class="note">
        Know someone looking to buy? Our partner programme pays
        commission on an introduction that closes —
        <a href="${SITE_URL}/realtors/partners">see how it works</a>.
      </p>
    `,
  );
  const text = [
    `Hi ${who},`,
    '',
    'Two things worth knowing: the app has moved on since you last opened it, and PropertyLoop now lists property of its own.',
    '',
    APP_TEXT,
    '',
    "PropertyLoop stock is property we list ourselves, verified by our team rather than forwarded from an agent. You will find it under PL stock on the app's home screen.",
    ...(property ? ['', propertyLines(property)] : []),
    '',
    `Know someone looking to buy? Our partner programme pays commission on an introduction that closes: ${SITE_URL}/realtors/partners`,
    '',
    'You are receiving this because you have a PropertyLoop account. To stop emails like this, reply with the word UNSUBSCRIBE.',
  ].join('\n');
  return { subject, html, text };
}

function buildFor(
  role: Role,
  name: string | null,
  property: StockProperty | null,
) {
  if (role === Role.AGENT) return agentEmail(name, property);
  if (role === Role.VENDOR) return vendorEmail(name);
  return buyerEmail(name, property);
}

/* ─── Sending ───────────────────────────────────────────────────────────── */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const send = args.includes('--send');
  const sampleFlag = args.indexOf('--sample');
  // Previews go to Ola unless another address is given after --sample.
  const sampleTo =
    sampleFlag !== -1 ? (args[sampleFlag + 1] ?? DEFAULT_SAMPLE_TO) : undefined;
  const onlyArg = args.find((a) => a.startsWith('--only='));
  const only = onlyArg
    ? (onlyArg.split('=')[1].toUpperCase() as Role)
    : undefined;

  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.MAIL_FROM;
  if (!process.env.RESEND_API_KEY || !from) {
    throw new Error('RESEND_API_KEY and MAIL_FROM must be set');
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: (process.env.DIRECT_URL || process.env.DATABASE_URL)!,
    }),
  } as any);

  try {
    // The newest live PropertyLoop property, for the versions that show one.
    const listing = await prisma.listing.findFirst({
      where: { ownership: 'HOUSE', status: 'ACTIVE' },
      orderBy: { publishedAt: 'desc' },
      select: {
        id: true,
        title: true,
        location: true,
        priceLabel: true,
        coverImage: true,
        beds: true,
        propertyType: true,
      },
    });
    const property: StockProperty | null = listing
      ? {
          id: listing.id,
          title: listing.title,
          location: listing.location,
          priceLabel: listing.priceLabel,
          coverImage: listing.coverImage || null,
          beds: listing.beds,
          type: listing.propertyType,
        }
      : null;
    console.log(
      property
        ? `Featuring: ${property.title} (${property.location})`
        : 'No live PropertyLoop stock — sending without a property.',
    );

    if (sampleTo) {
      for (const role of [Role.AGENT, Role.VENDOR, Role.BUYER]) {
        const { subject, html, text } = buildFor(role, 'Sample', property);
        await resend.emails.send({
          from,
          to: sampleTo,
          subject: `[${role}] ${subject}`,
          html,
          text,
        });
        console.log(`Sample ${role} → ${sampleTo}`);
        await sleep(GAP_MS);
      }
      return;
    }

    const recipients = await prisma.user.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        role: only ? only : { in: [Role.AGENT, Role.VENDOR, Role.BUYER] },
      },
      select: { name: true, email: true, role: true },
      orderBy: { createdAt: 'asc' },
    });
    const counts = recipients.reduce<Record<string, number>>((acc, r) => {
      acc[r.role] = (acc[r.role] ?? 0) + 1;
      return acc;
    }, {});
    console.log(`${recipients.length} recipient(s):`, counts);

    if (!send || dry) {
      console.log(
        'Dry run. Re-run with --send to actually email these people.',
      );
      return;
    }

    let sent = 0;
    let failed = 0;
    for (const [i, person] of recipients.entries()) {
      if (!person.email) continue;
      const { subject, html, text } = buildFor(
        person.role,
        person.name,
        property,
      );
      try {
        await resend.emails.send({
          from,
          to: person.email,
          subject,
          html,
          text,
        });
        sent += 1;
        console.log(
          `✓ ${i + 1}/${recipients.length} ${person.role} ${person.email}`,
        );
      } catch (err) {
        failed += 1;
        console.error(`✗ ${person.email}:`, (err as Error).message);
      }
      if (i < recipients.length - 1) await sleep(GAP_MS);
    }
    console.log(`\nDone. Sent ${sent}, failed ${failed}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
