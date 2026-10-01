/**
 * Independence Day greeting to everyone with a PropertyLoop account.
 *
 * One version for everybody. A greeting that sells something is not a
 * greeting, so there is no offer in here, no property, and no call to act —
 * only the day, and the poster the website and the app are showing.
 *
 * Usage:
 *   npx ts-node scripts/send-independence-day.ts --dry
 *   npx ts-node scripts/send-independence-day.ts --sample
 *   npx ts-node scripts/send-independence-day.ts --sample someone@example.com
 *   npx ts-node scripts/send-independence-day.ts --send
 *
 * --send is required to email real people. Without it the script only counts.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Resend } from 'resend';
import { PrismaClient, Role } from '../generated/prisma/client';
import { SITE_URL, firstName, shell } from '../src/stock-alerts/stock-email';

/** Spacing between sends, as in the other broadcast scripts. */
const GAP_MS = 600;

/** Where a preview goes when --sample names no address. */
const DEFAULT_SAMPLE_TO = 'olaoluwaoyetibo@gmail.com';

/**
 * Served from the website's public folder, so the poster in the email is the
 * same file the site and the app show. It resolves only once the frontend
 * carrying it has been deployed — send after that, or the image is a blank.
 */
const POSTER_URL = `${SITE_URL}/independence-2026.jpg`;

const YEARS = 66;

function greeting(name: string | null) {
  const who = firstName(name);
  const subject = `Happy Independence Day, ${who} 🇳🇬`;

  const html = shell(
    subject,
    `
      <div class="greeting">Hi ${who},</div>
      <p class="body-text">
        Nigeria is ${YEARS} today. From all of us at PropertyLoop, happy
        Independence Day.
      </p>
      <p>
        <img
          src="${POSTER_URL}"
          alt="Happy Independence Day Nigeria — Nigeria at ${YEARS}, 1st October. From PropertyLoop."
          style="width:100%;max-width:420px;border-radius:14px;display:block;margin:18px auto;"
        />
      </p>
      <p class="body-text">
        We spend our days on one idea: that finding, buying and keeping a home
        here should be straightforward and safe. Thank you for building that
        with us this year.
      </p>
      <p class="body-text">
        Here's to a home for every Nigerian.
      </p>
      <p class="note">
        Enjoy the day — from the team at PropertyLoop.
      </p>
    `,
  );

  const text = [
    `Hi ${who},`,
    '',
    `Nigeria is ${YEARS} today. From all of us at PropertyLoop, happy Independence Day.`,
    '',
    'We spend our days on one idea: that finding, buying and keeping a home here should be straightforward and safe. Thank you for building that with us this year.',
    '',
    "Here's to a home for every Nigerian.",
    '',
    'Enjoy the day — from the team at PropertyLoop.',
    '',
    'You are receiving this because you have a PropertyLoop account. To stop emails like this, reply with the word UNSUBSCRIBE.',
  ].join('\n');

  return { subject, html, text };
}

/* ─── Sending ───────────────────────────────────────────────────────────── */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const send = args.includes('--send');
  const sampleFlag = args.indexOf('--sample');
  const sampleTo =
    sampleFlag !== -1 ? (args[sampleFlag + 1] ?? DEFAULT_SAMPLE_TO) : undefined;

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
    if (sampleTo) {
      const { subject, html, text } = greeting('Sample');
      const res = await resend.emails.send({
        from,
        to: sampleTo,
        subject,
        html,
        text,
      });
      // Resend reports API failures in the response rather than by throwing,
      // so an unchecked send prints success for mail that was never accepted.
      if (res.error) {
        throw new Error(`${res.error.name}: ${res.error.message}`);
      }
      console.log(`Sample → ${sampleTo} (id ${res.data?.id})`);
      return;
    }

    const recipients = await prisma.user.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        role: { in: [Role.AGENT, Role.VENDOR, Role.BUYER] },
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
      console.log('Dry run. Re-run with --send to actually email these people.');
      return;
    }

    let sent = 0;
    let failed = 0;
    for (const person of recipients) {
      const { subject, html, text } = greeting(person.name);
      try {
        const res = await resend.emails.send({
          from,
          to: person.email,
          subject,
          html,
          text,
        });
        // An unchecked send counts a rejection as a success, which is how a
        // whole broadcast gets reported as delivered while nobody receives it.
        if (res.error) {
          throw new Error(`${res.error.name}: ${res.error.message}`);
        }
        sent += 1;
        console.log(`✓ ${person.email}`);
      } catch (err) {
        failed += 1;
        console.error(`✗ ${person.email}`, (err as Error).message);
      }
      await sleep(GAP_MS);
    }
    console.log(`Done. Sent ${sent}, failed ${failed}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
