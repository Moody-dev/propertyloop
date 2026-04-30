/**
 * Script: send-agent-add-property-guide.ts
 *
 * Sends a "How to add a property" guide to every signed-up agent
 * (User where role=AGENT, isActive=true, deletedAt=null).
 *
 * Usage:
 *   # Sample first — sends only to olaoluwaoyetibo@gmail.com to preview
 *   npx ts-node -r tsconfig-paths/register scripts/send-agent-add-property-guide.ts --sample
 *
 *   # Full send to all agents
 *   npx ts-node -r tsconfig-paths/register scripts/send-agent-add-property-guide.ts
 */

import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { Resend } from 'resend';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);
const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.MAIL_FROM!;

const LOGO_URL =
  'https://image2url.com/r2/default/images/1774405533651-13ef5a22-bfcb-4d8e-801e-563f4451c8b0.png';

const SAMPLE_EMAIL = 'olaoluwaoyetibo@gmail.com';
const ADD_PROPERTY_URL = 'https://propertyloop.ng/add-property';
const DASHBOARD_URL = 'https://propertyloop.ng/agent-dashboard';

function firstNameOf(fullName: string | null | undefined): string {
  if (!fullName) return 'there';
  return fullName.trim().split(/\s+/)[0] || 'there';
}

function buildEmail(firstName: string): { html: string; text: string } {
  const steps = [
    {
      n: '1',
      title: 'Property Details',
      desc: 'Pick the listing type (Sale, Rent, or Shortlet), choose the property type, then fill in the title, address, beds/baths, size, price in Naira, and a clear description. Tap the features that apply (24hr power, borehole, parking, etc.) — these power buyer search filters.',
    },
    {
      n: '2',
      title: 'Photos & Documents',
      desc: 'Upload at least one bright, well-framed cover photo plus 4–8 gallery shots. You can optionally add a walkthrough video and supporting documents (title deed, C of O, survey). Photos sell — daylight, wide angles, and a tidy frame outperform anything else.',
    },
    {
      n: '3',
      title: 'Review & Submit',
      desc: 'Double-check the price, location, and key details, then submit. Your listing goes live as PENDING REVIEW first — once our team verifies it (usually within 24 hours), it switches to ACTIVE and starts appearing in buyer searches.',
    },
  ];

  const tips = [
    'Use Naira for the price — no commas, no currency symbol. Just the number.',
    'Year built is optional. Leave it blank if you don\'t know it for certain.',
    'When a property is closed, open it from your dashboard and switch its status to SOLD or RENTED — it moves to your Logbook automatically.',
    'Need to edit a listing? Go to your dashboard → My Listings → click Edit on any card.',
  ];

  const stepRows = steps
    .map(
      (s) => `
    <div class="step-row">
      <div class="step-num">${s.n}</div>
      <div class="step-content">
        <div class="step-title">${s.title}</div>
        <div class="step-desc">${s.desc}</div>
      </div>
    </div>`,
    )
    .join('');

  const tipRows = tips
    .map(
      (t) => `
    <div class="tip-row">
      <div class="tip-dot"></div>
      <div class="tip-text">${t}</div>
    </div>`,
    )
    .join('');

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>How to add a property on PropertyLoop</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
        background-color: #f4f4f5;
        color: #111827;
        line-height: 1.6;
        -webkit-font-smoothing: antialiased;
      }
      .wrapper { background-color: #f4f4f5; padding: 40px 16px; }
      .container {
        max-width: 600px;
        margin: 0 auto;
        background-color: #ffffff;
        border-radius: 8px;
        border: 1px solid #e5e7eb;
        overflow: hidden;
      }
      .header {
        background-color: #0f1f14;
        padding: 36px 48px;
        text-align: left;
      }
      .header img { height: 36px; width: auto; display: block; }
      .divider-green { height: 3px; background-color: #2f9e61; }
      .content { padding: 48px; }
      .greeting {
        font-size: 22px;
        font-weight: 600;
        color: #111827;
        margin-bottom: 16px;
        letter-spacing: -0.3px;
      }
      .body-text {
        font-size: 15px;
        color: #4b5563;
        line-height: 1.75;
        margin-bottom: 32px;
      }
      .section-label {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 1px;
        text-transform: uppercase;
        color: #2f9e61;
        margin-bottom: 18px;
      }
      .step-list { margin-bottom: 36px; }
      .step-row {
        display: flex;
        align-items: flex-start;
        padding: 18px 0;
        border-bottom: 1px solid #f3f4f6;
      }
      .step-row:last-child { border-bottom: none; }
      .step-num {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background-color: #2f9e61;
        color: #ffffff;
        font-weight: 700;
        font-size: 14px;
        text-align: center;
        line-height: 32px;
        margin-right: 16px;
        flex-shrink: 0;
      }
      .step-content { flex: 1; }
      .step-title {
        font-size: 15px;
        font-weight: 600;
        color: #111827;
        margin-bottom: 4px;
      }
      .step-desc {
        font-size: 14px;
        color: #6b7280;
        line-height: 1.65;
      }
      .cta-block { margin: 32px 0; text-align: center; }
      .cta-btn {
        display: inline-block;
        background-color: #2f9e61;
        color: #ffffff;
        font-size: 15px;
        font-weight: 600;
        text-decoration: none;
        padding: 14px 32px;
        border-radius: 6px;
        letter-spacing: 0.2px;
      }
      .cta-sub {
        font-size: 12px;
        color: #9ca3af;
        margin-top: 12px;
      }
      .cta-sub a { color: #6b7280; text-decoration: underline; }
      .tips-card {
        background-color: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 6px;
        padding: 20px 22px;
        margin-bottom: 32px;
      }
      .tip-row {
        display: flex;
        align-items: flex-start;
        padding: 6px 0;
      }
      .tip-dot {
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background-color: #2f9e61;
        margin-top: 9px;
        margin-right: 12px;
        flex-shrink: 0;
      }
      .tip-text {
        flex: 1;
        font-size: 13.5px;
        color: #4b5563;
        line-height: 1.65;
      }
      .divider {
        border: none;
        border-top: 1px solid #e5e7eb;
        margin: 32px 0;
      }
      .closing { font-size: 14.5px; color: #4b5563; line-height: 1.75; }
      .signature { margin-top: 28px; }
      .signature-name { font-size: 14px; font-weight: 600; color: #111827; }
      .signature-title { font-size: 13px; color: #9ca3af; margin-top: 2px; }
      .footer {
        background-color: #f9fafb;
        border-top: 1px solid #e5e7eb;
        padding: 28px 48px;
        text-align: center;
      }
      .footer-logo { margin-bottom: 16px; }
      .footer-logo img { height: 24px; width: auto; opacity: 0.6; }
      .footer-copy { font-size: 11px; color: #d1d5db; }
      @media (max-width: 600px) {
        .content { padding: 32px 24px; }
        .header { padding: 28px 24px; }
        .footer { padding: 24px; }
      }
    </style>
  </head>
  <body>
    <div class="wrapper">
      <div class="container">
        <div class="header">
          <img src="${LOGO_URL}" alt="PropertyLoop">
        </div>
        <div class="divider-green"></div>

        <div class="content">
          <div class="greeting">Hi ${firstName},</div>

          <p class="body-text">
            Thanks for joining PropertyLoop as an agent. This is a quick walkthrough on how to put your first listing in front of buyers — it takes about five minutes once you have your photos ready.
          </p>

          <div class="section-label">Adding a property — three steps</div>
          <div class="step-list">
            ${stepRows}
          </div>

          <div class="cta-block">
            <a href="${ADD_PROPERTY_URL}" class="cta-btn">Add a Property</a>
            <div class="cta-sub">
              Or open it from your <a href="${DASHBOARD_URL}">agent dashboard</a> → My Listings → Add Listing.
            </div>
          </div>

          <div class="section-label">Tips before you submit</div>
          <div class="tips-card">
            ${tipRows}
          </div>

          <hr class="divider">

          <p class="closing">
            Questions about a listing, a verification, or anything else? Reply to this email — it goes straight to our team.
          </p>

          <div class="signature">
            <div class="signature-name">The PropertyLoop Team</div>
            <div class="signature-title">propertyloop.ng</div>
          </div>
        </div>

        <div class="footer">
          <div class="footer-logo">
            <img src="${LOGO_URL}" alt="PropertyLoop">
          </div>
          <div class="footer-copy">&copy; 2026 PropertyLoop. All rights reserved.</div>
        </div>
      </div>
    </div>
  </body>
</html>`;

  const text = `Hi ${firstName},

Thanks for joining PropertyLoop as an agent. Here's a quick walkthrough on how to put your first listing in front of buyers — about five minutes once your photos are ready.

ADDING A PROPERTY — THREE STEPS

1. Property Details
   Pick the listing type (Sale / Rent / Shortlet), choose the property type, then fill in the title, address, beds/baths, size, price in Naira, and a clear description. Select the features that apply — they power buyer search filters.

2. Photos & Documents
   Upload at least one bright cover photo plus 4–8 gallery shots. You can also add a walkthrough video and supporting documents (title deed, C of O, survey). Daylight, wide angles, and a tidy frame outperform anything else.

3. Review & Submit
   Double-check the price, location, and key details, then submit. Your listing starts as PENDING REVIEW; once our team verifies it (usually within 24 hours), it goes ACTIVE and starts appearing in buyer searches.

Get started: ${ADD_PROPERTY_URL}
Or open it from your agent dashboard: ${DASHBOARD_URL}

TIPS BEFORE YOU SUBMIT
• Use Naira for the price — no commas, no currency symbol. Just the number.
• Year built is optional. Leave it blank if you don't know it for certain.
• When a property is closed, open it from your dashboard and switch its status to SOLD or RENTED — it moves to your Logbook automatically.
• Need to edit a listing? Dashboard → My Listings → click Edit on any card.

Questions? Reply to this email — it goes straight to our team.

The PropertyLoop Team
propertyloop.ng`;

  return { html, text };
}

async function sendToOne(
  email: string,
  firstName: string,
  label: string,
): Promise<boolean> {
  const { html, text } = buildEmail(firstName);
  try {
    await resend.emails.send({
      from: FROM,
      to: email,
      subject: 'How to add your first property on PropertyLoop',
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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const isSample = process.argv.includes('--sample');

  if (!process.env.RESEND_API_KEY) {
    console.error('ERROR: RESEND_API_KEY not set in .env');
    process.exit(1);
  }
  if (!FROM) {
    console.error('ERROR: MAIL_FROM not set in .env');
    process.exit(1);
  }

  if (isSample) {
    console.log('--- SAMPLE MODE: sending to', SAMPLE_EMAIL, '---');
    await sendToOne(SAMPLE_EMAIL, 'there', 'SAMPLE');
    console.log(
      'Done. Review the email, then run without --sample to send to all signed-up agents.',
    );
    await prisma.$disconnect();
    await pool.end();
    return;
  }

  // Full send — every active, non-deleted user with role=AGENT
  const agents = await prisma.user.findMany({
    where: {
      role: 'AGENT',
      isActive: true,
      deletedAt: null,
    },
    select: { id: true, email: true, name: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Found ${agents.length} signed-up agent(s) to email.`);
  if (agents.length === 0) {
    console.log('Nothing to do.');
    await prisma.$disconnect();
    await pool.end();
    return;
  }

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    const ok = await sendToOne(
      agent.email,
      firstNameOf(agent.name),
      `${i + 1}/${agents.length}`,
    );
    if (ok) sent++;
    else failed++;

    // Resend free tier ~2 req/s — throttle to stay safe
    if (i < agents.length - 1) await sleep(600);
  }

  console.log(`\nDone. Sent: ${sent}  Failed: ${failed}`);
  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  await pool.end();
  process.exit(1);
});
