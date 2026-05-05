/**
 * Send a "we're still cooking" warm-up note to builders and building-materials
 * suppliers/installers on the waitlist who haven't been activated yet.
 *
 * Deliberately avoids any "we're live" messaging or activation CTA — this is
 * a relationship-keeping note while the trades-vendor experience is being
 * polished.
 *
 * Usage:
 *   # Sample — sends only to olaoluwaoyetibo@gmail.com
 *   npx ts-node scripts/send-vendor-warmup-email.ts --sample
 *
 *   # Full send
 *   npx ts-node scripts/send-vendor-warmup-email.ts --send
 */

import 'dotenv/config';
import { Resend } from 'resend';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
} as any);
const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.MAIL_FROM!;

const LOGO_URL =
  'https://image2url.com/r2/default/images/1774405533651-13ef5a22-bfcb-4d8e-801e-563f4451c8b0.png';

const SAMPLE_EMAIL = 'olaoluwaoyetibo@gmail.com';
const TARGET_TYPES: Array<'BUILDER' | 'BUILDING_MATERIALS_SUPPLIER_INSTALLER'> =
  ['BUILDER', 'BUILDING_MATERIALS_SUPPLIER_INSTALLER'];

function tradeLabel(type: string): string {
  if (type === 'BUILDER') return 'a builder';
  if (type === 'BUILDING_MATERIALS_SUPPLIER_INSTALLER')
    return 'a building-materials supplier or installer';
  return 'a service vendor';
}

function buildEmail(firstName: string, type: string): { html: string; text: string } {
  const trade = tradeLabel(type);

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>A quick note from PropertyLoop</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
        background-color: #f4f4f5;
        color: #111827;
        line-height: 1.65;
      }
      .wrapper { background-color: #f4f4f5; padding: 40px 16px; }
      .container {
        max-width: 580px; margin: 0 auto; background-color: #ffffff;
        border-radius: 8px; border: 1px solid #e5e7eb; overflow: hidden;
      }
      .header { background-color: #0f1f14; padding: 32px 44px; }
      .header img { height: 32px; display: block; }
      .divider-green { height: 3px; background-color: #2f9e61; }
      .content { padding: 42px 44px; }
      .greeting {
        font-size: 20px; font-weight: 600; color: #111827; margin-bottom: 18px;
        letter-spacing: -0.2px;
      }
      .body-text {
        font-size: 15px; color: #374151; line-height: 1.75; margin-bottom: 18px;
      }
      .body-text strong { color: #111827; font-weight: 600; }
      .pull-quote {
        font-size: 18px; font-weight: 600; color: #1f6f43;
        margin: 28px 0; padding: 4px 0 4px 16px;
        border-left: 3px solid #2f9e61; letter-spacing: -0.2px;
      }
      .ask-card {
        background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px;
        padding: 20px 22px; margin: 24px 0;
      }
      .ask-card .label {
        font-size: 11px; font-weight: 700; letter-spacing: 1.2px;
        text-transform: uppercase; color: #2f9e61; margin-bottom: 8px;
      }
      .ask-card .ask {
        font-size: 15px; color: #111827; line-height: 1.6; font-weight: 500;
      }
      .signature { margin-top: 32px; }
      .signature-name { font-size: 14px; font-weight: 600; color: #111827; }
      .signature-title { font-size: 13px; color: #9ca3af; margin-top: 2px; }
      .footer {
        background-color: #f9fafb; border-top: 1px solid #e5e7eb;
        padding: 22px 44px; text-align: center;
      }
      .footer img { height: 22px; opacity: 0.55; }
      .footer-copy { font-size: 11px; color: #9ca3af; margin-top: 10px; }
      @media (max-width: 600px) {
        .content { padding: 32px 22px; }
        .header { padding: 26px 22px; }
        .footer { padding: 22px; }
      }
    </style>
  </head>
  <body>
    <div class="wrapper">
      <div class="container">
        <div class="header"><img src="${LOGO_URL}" alt="PropertyLoop"></div>
        <div class="divider-green"></div>
        <div class="content">
          <div class="greeting">Hi ${firstName},</div>

          <p class="body-text">
            A quick note from the PropertyLoop team. You joined the waitlist as ${trade}, you've been patient with us, and we wanted to reach out properly before the next message lands.
          </p>

          <p class="pull-quote">We've cooked.</p>

          <p class="body-text">
            We've spent the last few months heads-down building the trades side of the platform the way you'd actually use it — lead flow that respects your time, payment that protects your work, and a buyer base that values your craft over the cheapest quote. It's done. It works.
          </p>

          <p class="body-text">
            You're at the front of the line. <strong>Keep an eye on your inbox over the next few days</strong> — your activation details are on the way, and you'll be among the very first builders and suppliers we open the doors to.
          </p>

          <p class="body-text">
            Thank you for the patience. The next message from us will be the one you've been waiting for.
          </p>

          <div class="signature">
            <div class="signature-name">The PropertyLoop Team</div>
            <div class="signature-title">propertyloop.ng</div>
          </div>
        </div>
        <div class="footer">
          <img src="${LOGO_URL}" alt="PropertyLoop">
          <div class="footer-copy">&copy; 2026 PropertyLoop. All rights reserved.</div>
        </div>
      </div>
    </div>
  </body>
</html>`;

  const text = `Hi ${firstName},

A quick note from the PropertyLoop team. You joined the waitlist as
${trade}, you've been patient with us, and we wanted to reach out
properly before the next message lands.

We've cooked.

We've spent the last few months heads-down building the trades side of
the platform the way you'd actually use it — lead flow that respects
your time, payment that protects your work, and a buyer base that
values your craft over the cheapest quote. It's done. It works.

You're at the front of the line. Keep an eye on your inbox over the
next few days — your activation details are on the way, and you'll be
among the very first builders and suppliers we open the doors to.

Thank you for the patience. The next message from us will be the one
you've been waiting for.

— The PropertyLoop Team
propertyloop.ng`;

  return { html, text };
}

async function sendToOne(
  email: string,
  firstName: string,
  type: string,
  label: string,
): Promise<boolean> {
  const { html, text } = buildEmail(firstName, type);
  try {
    await resend.emails.send({
      from: FROM,
      to: email,
      subject: "We've cooked — your activation is on its way",
      html,
      text,
    });
    console.log(`✓ [${label}] Sent to ${email}`);
    return true;
  } catch (err: any) {
    console.error(`✗ [${label}] Failed for ${email}:`, err?.message ?? err);
    return false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const isSample = process.argv.includes('--sample');
  const isSend = process.argv.includes('--send');

  if (!isSample && !isSend) {
    console.error('Usage: --sample  OR  --send');
    process.exit(1);
  }
  if (!process.env.RESEND_API_KEY) {
    console.error('ERROR: RESEND_API_KEY not set');
    process.exit(1);
  }
  if (!FROM) {
    console.error('ERROR: MAIL_FROM not set');
    process.exit(1);
  }

  if (isSample) {
    console.log(`--- SAMPLE MODE: sending to ${SAMPLE_EMAIL} (as BUILDER) ---`);
    await sendToOne(SAMPLE_EMAIL, 'there', 'BUILDER', 'SAMPLE');
    console.log('\nDone. Review the email, then re-run with --send for the full list.');
    await prisma.$disconnect();
    return;
  }

  // Full send — only unactivated trade vendors
  const recipients = await prisma.waitlistEntry.findMany({
    where: {
      activated: false,
      type: { in: TARGET_TYPES },
    },
    orderBy: { created_at: 'asc' },
  });

  console.log(`Resolved ${recipients.length} unactivated trade-vendor recipients.`);
  if (recipients.length === 0) {
    console.log('Nothing to send.');
    await prisma.$disconnect();
    return;
  }

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < recipients.length; i++) {
    const r = recipients[i];
    const ok = await sendToOne(
      r.email,
      r.first_name || 'there',
      r.type,
      `${i + 1}/${recipients.length}`,
    );
    if (ok) sent++;
    else failed++;
    if (i < recipients.length - 1) await sleep(600);
  }

  console.log(`\n══════ DONE ══════\nSent OK : ${sent}\nFailed  : ${failed}`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
