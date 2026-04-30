/**
 * Script: send-agent-feature-email.ts
 * Sends a feature announcement email to all REAL_ESTATE_AGENT waitlist entries.
 * Pass --sample to send only to olaoluwaoyetibo@gmail.com first.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/send-agent-feature-email.ts --sample
 *   npx ts-node -r tsconfig-paths/register scripts/send-agent-feature-email.ts
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

function buildEmail(firstName: string): { html: string; text: string } {
  const features = [
    {
      title: 'Listings Management',
      desc: 'Create, update, and manage your property listings — for sale, rent, or shortlet — all from a single dashboard.',
    },
    {
      title: 'Viewings Scheduler',
      desc: 'Buyers can request property viewings directly from your listings. Confirm, complete, or cancel from your dashboard.',
    },
    {
      title: 'Built-in Messaging',
      desc: 'Chat with buyers and clients without leaving the platform. Start conversations directly from viewing requests.',
    },
    {
      title: 'Analytics Dashboard',
      desc: 'Track profile views, listing impressions, and deal activity so you can make smarter business decisions.',
    },
    {
      title: 'Public Agent Profile',
      desc: 'A professional public profile showcasing your listings, reviews, deals closed, and contact details.',
    },
    {
      title: 'KYC Verified Badge',
      desc: 'Complete identity verification to earn the verified badge — boosting trust and credibility with buyers.',
    },
    {
      title: 'Client Reviews',
      desc: 'Collect and display authentic reviews from buyers and tenants to build your reputation on the platform.',
    },
    {
      title: 'Lead Alerts & Notifications',
      desc: 'Get notified instantly when a buyer enquires about your listing or books a viewing.',
    },
  ];

  const featureRows = features
    .map(
      (f) => `
    <div class="feature-row">
      <div class="feature-dot"></div>
      <div class="feature-content">
        <div class="feature-title">${f.title}</div>
        <div class="feature-desc">${f.desc}</div>
      </div>
    </div>`,
    )
    .join('');

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Your PropertyLoop Agent Platform is Ready</title>
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
        margin-bottom: 16px;
      }
      .feature-list { margin-bottom: 36px; }
      .feature-row {
        display: flex;
        align-items: flex-start;
        padding: 14px 0;
        border-bottom: 1px solid #f3f4f6;
      }
      .feature-row:last-child { border-bottom: none; }
      .feature-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background-color: #2f9e61;
        margin-top: 8px;
        margin-right: 14px;
        flex-shrink: 0;
      }
      .feature-content { flex: 1; }
      .feature-title {
        font-size: 14px;
        font-weight: 600;
        color: #111827;
        margin-bottom: 2px;
      }
      .feature-desc {
        font-size: 14px;
        color: #6b7280;
        line-height: 1.6;
      }
      .cta-block { margin: 36px 0; text-align: center; }
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
      .divider {
        border: none;
        border-top: 1px solid #e5e7eb;
        margin: 36px 0;
      }
      .closing { font-size: 15px; color: #4b5563; line-height: 1.75; }
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
      .footer-links { font-size: 12px; color: #9ca3af; margin-bottom: 10px; }
      .footer-links a { color: #6b7280; text-decoration: none; margin: 0 10px; }
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
            Here's a look at what's coming to you as a registered agent on PropertyLoop — built to help you grow your real estate business in Nigeria.
          </p>

          <div class="section-label">What you get as an agent</div>
          <div class="feature-list">
            ${featureRows}
          </div>

          <div class="cta-block">
            <a href="https://propertyloop.ng" class="cta-btn">Explore the Platform</a>
          </div>

          <hr class="divider">

          <p class="closing">
            You joined the waitlist because you believe in a better way to do real estate. We built this for you — and we're just getting started.
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

Here's a look at what's coming to you as a registered agent on PropertyLoop:

• Listings Management — Create, update, and manage your property listings from a single dashboard.
• Viewings Scheduler — Buyers can request viewings directly from your listings.
• Built-in Messaging — Chat with buyers without leaving the platform.
• Analytics Dashboard — Track profile views, listing impressions, and deal activity.
• Public Agent Profile — A professional profile showcasing your listings, reviews, and contact details.
• KYC Verified Badge — Complete verification to earn a verified badge that builds buyer trust.
• Client Reviews — Collect and display authentic reviews to build your reputation.
• Lead Alerts & Notifications — Get notified instantly when a buyer enquires or books a viewing.

Visit https://propertyloop.ng to explore the platform.

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
      subject: 'Your PropertyLoop Agent Features Are Ready 🏡',
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
      'Done. Review the email, then run without --sample to send to all agents.',
    );
    await prisma.$disconnect();
    await pool.end();
    return;
  }

  // Full send
  const agents = await prisma.waitlistEntry.findMany({
    where: { type: 'REAL_ESTATE_AGENT' },
    orderBy: { created_at: 'asc' },
  });

  console.log(`Found ${agents.length} real estate agent(s) on the waitlist.`);

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    const ok = await sendToOne(
      agent.email,
      agent.first_name,
      `${i + 1}/${agents.length}`,
    );
    if (ok) sent++;
    else failed++;

    // Resend free tier: ~2 req/s — throttle to stay safe
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
