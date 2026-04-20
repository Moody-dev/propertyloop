/**
 * PropertyLoop — Launch Announcement Broadcast Email
 *
 * Usage:
 *   npx ts-node scripts/send-launch-email.ts --test          # send to test email only
 *   npx ts-node scripts/send-launch-email.ts --broadcast     # send to ALL waitlist users
 */

import { Resend } from 'resend';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const RESEND_API_KEY = process.env.RESEND_API_KEY!;
const MAIL_FROM = process.env.MAIL_FROM || 'PropertyLoop <noreply@propertyloop.ng>';
const MAIL_FROM_TEST = 'PropertyLoop <onboarding@resend.dev>'; // Resend default sender for testing
const LOGO_URL = 'https://image2url.com/r2/default/images/1774405533651-13ef5a22-bfcb-4d8e-801e-563f4451c8b0.png';
const TEST_EMAIL = 'olaoluwaoyetibo@gmail.com';

const resend = new Resend(RESEND_API_KEY);
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter } as any);

function getLaunchAnnouncementTemplate(firstName: string): string {
  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>PropertyLoop — We're Almost Ready</title>
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
          .divider-green {
            height: 3px;
            background-color: #2f9e61;
          }
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
          .highlight-box {
            background-color: #f0fdf4;
            border: 1px solid #bbf7d0;
            border-radius: 8px;
            padding: 24px;
            margin-bottom: 32px;
            text-align: center;
          }
          .highlight-emoji {
            font-size: 32px;
            margin-bottom: 12px;
          }
          .highlight-title {
            font-size: 18px;
            font-weight: 700;
            color: #166534;
            margin-bottom: 6px;
          }
          .highlight-desc {
            font-size: 14px;
            color: #4b5563;
            line-height: 1.6;
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
          .divider {
            border: none;
            border-top: 1px solid #e5e7eb;
            margin: 36px 0;
          }
          .closing { font-size: 15px; color: #4b5563; line-height: 1.75; }
          .signature { margin-top: 28px; }
          .signature-name {
            font-size: 14px;
            font-weight: 600;
            color: #111827;
          }
          .signature-title {
            font-size: 13px;
            color: #9ca3af;
            margin-top: 2px;
          }
          .footer {
            background-color: #f9fafb;
            border-top: 1px solid #e5e7eb;
            padding: 28px 48px;
            text-align: center;
          }
          .footer-logo { margin-bottom: 16px; }
          .footer-logo img { height: 24px; width: auto; opacity: 0.6; }
          .footer-links {
            font-size: 12px;
            color: #9ca3af;
            margin-bottom: 10px;
          }
          .footer-links a {
            color: #6b7280;
            text-decoration: none;
            margin: 0 10px;
          }
          .footer-links a:hover { color: #111827; }
          .footer-copy {
            font-size: 11px;
            color: #d1d5db;
          }
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
                Welcome to PropertyLoop — Nigeria's enterprise platform for real estate development, transactions, and services. We're glad you're here.
              </p>

              <div class="highlight-box">
                <div class="highlight-emoji">🚀</div>
                <div class="highlight-title">We Go Live in a Few Days</div>
                <div class="highlight-desc">
                  We've spent the last few months building, not talking. PropertyLoop was engineered to fix the biggest pain points in Nigerian real estate. It's almost ready for you.
                </div>
              </div>

              <div class="section-label">What you can do on PropertyLoop from Day 1</div>
              <div class="feature-list">
                <div class="feature-row">
                  <div class="feature-dot"></div>
                  <div class="feature-content">
                    <div class="feature-title">Verified Property Listings</div>
                    <div class="feature-desc">List and discover properties for sale, rent, or shortlet. Video tours, verified agents, transparent pricing. No more guesswork.</div>
                  </div>
                </div>
                <div class="feature-row">
                  <div class="feature-dot"></div>
                  <div class="feature-content">
                    <div class="feature-title">The Service Loop</div>
                    <div class="feature-desc">Instantly book KYC-verified artisans — plumbers, electricians, cleaners, AC techs. Vetted, rated, and ready to work.</div>
                  </div>
                </div>
                <div class="feature-row">
                  <div class="feature-dot"></div>
                  <div class="feature-content">
                    <div class="feature-title">Materials Marketplace</div>
                    <div class="feature-desc">Source building and finishing materials from trusted suppliers at competitive prices. Cement to tiles, all in one place.</div>
                  </div>
                </div>
                <div class="feature-row">
                  <div class="feature-dot"></div>
                  <div class="feature-content">
                    <div class="feature-title">Professional Dashboards</div>
                    <div class="feature-desc">Agents manage listings and leads. Vendors track jobs and earnings. Developers monitor projects. Everything in one view.</div>
                  </div>
                </div>
              </div>

              <hr class="divider">

              <p class="closing">
                <strong>What's next:</strong> We'll send your access details the moment we go live. Keep an eye on your inbox — we're launching in a few days.
              </p>

              <p class="closing" style="margin-top: 16px;">
                Ready to loop in?
              </p>

              <div class="signature">
                <div class="signature-name">Best regards,</div>
                <div class="signature-name">The PropertyLoop Team</div>
                <div class="signature-title">www.propertyloop.ng</div>
              </div>
            </div>

            <div class="footer">
              <div class="footer-logo">
                <img src="${LOGO_URL}" alt="PropertyLoop">
              </div>
              <div class="footer-links">
                <a href="https://propertyloop.ng/privacy">Privacy Policy</a>
                <a href="https://propertyloop.ng/terms">Terms of Service</a>
                <a href="https://propertyloop.ng/contact">Contact</a>
              </div>
              <div class="footer-copy">&copy; 2026 PropertyLoop. All rights reserved.</div>
            </div>
          </div>
        </div>
      </body>
    </html>
  `;
}

async function sendTestEmail() {
  console.log('📧 Sending test email to:', TEST_EMAIL);
  const html = getLaunchAnnouncementTemplate('Olaoluwa');
  const result = await resend.emails.send({
    from: MAIL_FROM,
    to: TEST_EMAIL,
    subject: `You're in, Olaoluwa. PropertyLoop launches this week.`,
    html,
  });
  console.log('✅ Test email sent!', result);
}

async function sendBroadcast() {
  const entries = await prisma.waitlistEntry.findMany({
    orderBy: { created_at: 'desc' },
  });

  console.log(`📧 Broadcasting to ${entries.length} waitlist users...`);

  let sent = 0;
  let failed = 0;

  for (const entry of entries) {
    try {
      const html = getLaunchAnnouncementTemplate(entry.first_name);
      await resend.emails.send({
        from: MAIL_FROM,
        to: entry.email,
        subject: `You're in, ${entry.first_name}. PropertyLoop launches this week.`,
        html,
      });
      sent++;
      console.log(`  ✅ [${sent}/${entries.length}] ${entry.email}`);

      // Small delay to respect rate limits
      if (sent % 10 === 0) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch (err) {
      failed++;
      console.error(`  ❌ Failed: ${entry.email}`, err);
    }
  }

  console.log(`\n📊 Done! Sent: ${sent} | Failed: ${failed} | Total: ${entries.length}`);
}

async function main() {
  const mode = process.argv[2];

  if (!RESEND_API_KEY) {
    console.error('❌ RESEND_API_KEY not found in .env');
    process.exit(1);
  }

  if (mode === '--test') {
    await sendTestEmail();
  } else if (mode === '--broadcast') {
    await sendBroadcast();
  } else {
    console.log('Usage:');
    console.log('  npx ts-node scripts/send-launch-email.ts --test       # test email');
    console.log('  npx ts-node scripts/send-launch-email.ts --broadcast  # all waitlist users');
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  prisma.$disconnect();
  process.exit(1);
});
