/**
 * Script: send-agent-profile-completion-email.ts
 *
 * Nudge every signed-up agent (User where role=AGENT, isActive=true,
 * deletedAt=null) to (1) finish their profile in Settings and (2) start
 * listing properties via Add Property / Add Listing.
 *
 * Includes two HTML mockups inside the email — a top-nav row and the
 * dashboard "Overview" header — so users see exactly where to click.
 *
 * Usage:
 *   # Sample first — sends only to olaoluwaoyetibo@gmail.com to preview
 *   npx ts-node -r tsconfig-paths/register scripts/send-agent-profile-completion-email.ts --sample
 *
 *   # Full send to all registered agents
 *   npx ts-node -r tsconfig-paths/register scripts/send-agent-profile-completion-email.ts
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
const SETTINGS_URL = 'https://www.propertyloop.ng/settings';
const ADD_PROPERTY_URL = 'https://www.propertyloop.ng/add-property';
const DASHBOARD_URL = 'https://www.propertyloop.ng/agent-dashboard';

function firstNameOf(fullName: string | null | undefined): string {
  if (!fullName) return 'there';
  return fullName.trim().split(/\s+/)[0] || 'there';
}

function buildEmail(firstName: string): { html: string; text: string } {
  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Complete your PropertyLoop profile</title>
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
      .content { padding: 44px 48px 36px; }
      .greeting {
        font-size: 22px;
        font-weight: 600;
        color: #111827;
        margin-bottom: 14px;
        letter-spacing: -0.3px;
      }
      .body-text {
        font-size: 15px;
        color: #4b5563;
        line-height: 1.75;
        margin-bottom: 28px;
      }
      .section-label {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 1px;
        text-transform: uppercase;
        color: #2f9e61;
        margin-top: 8px;
        margin-bottom: 14px;
      }
      .step-title {
        font-size: 17px;
        font-weight: 600;
        color: #111827;
        margin-bottom: 8px;
      }
      .step-desc {
        font-size: 14.5px;
        color: #4b5563;
        line-height: 1.7;
        margin-bottom: 18px;
      }
      .cta {
        display: inline-block;
        background-color: #2f9e61;
        color: #ffffff !important;
        font-size: 14.5px;
        font-weight: 600;
        text-decoration: none;
        padding: 12px 28px;
        border-radius: 6px;
        letter-spacing: 0.2px;
      }
      .cta-secondary {
        display: inline-block;
        background-color: #ffffff;
        color: #111827 !important;
        font-size: 14.5px;
        font-weight: 600;
        text-decoration: none;
        padding: 12px 28px;
        border-radius: 6px;
        border: 1px solid #d1d5db;
        letter-spacing: 0.2px;
      }
      /* Mockup: navbar row */
      .mockup-card {
        background-color: #faf6f1;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 20px 22px;
        margin: 18px 0 26px;
      }
      .mockup-caption {
        font-size: 11.5px;
        color: #6b7280;
        margin-top: 12px;
        text-align: center;
        letter-spacing: 0.4px;
      }
      .mockup-navbar {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        column-gap: 14px;
        row-gap: 10px;
        flex-wrap: wrap;
      }
      .nav-link {
        font-size: 14px;
        color: #1a3d2a;
        font-weight: 600;
        padding: 6px 4px;
      }
      .nav-pill {
        font-size: 14px;
        font-weight: 700;
        padding: 8px 16px;
        border-radius: 999px;
        white-space: nowrap;
      }
      .nav-pill-add {
        background-color: #ffffff;
        color: #1a3d2a;
        border: 2px solid #2f9e61;
      }
      .nav-pill-dashboard {
        background-color: #d8eadd;
        color: #1a3d2a;
      }
      .nav-pill-logout {
        background-color: #fde8e8;
        color: #c93434;
      }
      /* Mockup: dashboard overview header */
      .mockup-dashboard {
        display: flex;
        align-items: center;
        justify-content: space-between;
        column-gap: 16px;
        row-gap: 14px;
        flex-wrap: wrap;
      }
      .dash-title-block {
        min-width: 0;
      }
      .dash-title {
        display: block;
        font-size: 18px;
        font-weight: 700;
        color: #111827;
        line-height: 1.2;
        margin: 0;
      }
      .dash-subtitle {
        display: block;
        font-size: 12px;
        color: #6b7280;
        margin: 6px 0 0;
      }
      .dash-cta {
        background-color: #2f9e61;
        color: #ffffff;
        font-weight: 700;
        font-size: 14px;
        padding: 10px 20px;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .dash-cta-plus {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        border-radius: 999px;
        background-color: rgba(255, 255, 255, 0.22);
        font-weight: 700;
        font-size: 14px;
        line-height: 1;
      }
      .divider {
        border: none;
        border-top: 1px solid #e5e7eb;
        margin: 32px 0;
      }
      .closing { font-size: 14.5px; color: #4b5563; line-height: 1.75; }
      .signature { margin-top: 24px; }
      .signature-name { font-size: 14px; font-weight: 600; color: #111827; }
      .signature-title { font-size: 13px; color: #9ca3af; margin-top: 2px; }
      .footer {
        background-color: #f9fafb;
        border-top: 1px solid #e5e7eb;
        padding: 26px 48px;
        text-align: center;
      }
      .footer-logo { margin-bottom: 14px; }
      .footer-logo img { height: 24px; width: auto; opacity: 0.6; }
      .footer-copy { font-size: 11px; color: #d1d5db; }
      @media (max-width: 600px) {
        .content { padding: 32px 24px; }
        .header { padding: 28px 24px; }
        .footer { padding: 24px; }
        .mockup-card { padding: 18px 16px; }
      }
      @media (max-width: 480px) {
        .mockup-navbar {
          justify-content: center;
          column-gap: 10px;
          row-gap: 8px;
        }
        .mockup-dashboard {
          flex-direction: column;
          align-items: flex-start;
          row-gap: 14px;
        }
        .dash-cta {
          align-self: stretch;
          justify-content: center;
        }
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
            Thanks again for joining PropertyLoop. Your account is set up — let's finish two quick things so buyers can find you and your listings.
          </p>

          <!-- ─── Step 1: Complete profile ─────────────────────── -->
          <div class="section-label">Step 1</div>
          <div class="step-title">Complete your profile in Settings</div>
          <p class="step-desc">
            A complete profile (photo, agency name, location, bio) makes your listings noticeably more credible — verified-looking agents convert leads at a much higher rate. It takes about a minute.
          </p>
          <a href="${SETTINGS_URL}" class="cta">Open Settings →</a>

          <hr class="divider">

          <!-- ─── Step 2: Add a property ───────────────────────── -->
          <div class="section-label">Step 2</div>
          <div class="step-title">Add your first property</div>
          <p class="step-desc">
            From any page on PropertyLoop, you'll see <strong>Add Property</strong> in the top-right of the navbar:
          </p>

          <!-- Mockup of the navbar row -->
          <div class="mockup-card">
            <div class="mockup-navbar">
              <span class="nav-link">About Us</span>
              <span class="nav-pill nav-pill-add">Add Property</span>
              <span class="nav-pill nav-pill-dashboard">Dashboard</span>
              <span class="nav-pill nav-pill-logout">Logout</span>
            </div>
            <div class="mockup-caption">↑ Click <strong>Add Property</strong> in the top navigation</div>
          </div>

          <p class="step-desc">
            Or, from your Agent Dashboard <strong>Overview</strong>, tap the green <strong>Add Listing</strong> button in the top-right:
          </p>

          <!-- Mockup of the dashboard overview header -->
          <div class="mockup-card">
            <div class="mockup-dashboard">
              <div class="dash-title-block">
                <div class="dash-title">Overview</div>
                <div class="dash-subtitle">${firstName}</div>
              </div>
              <span class="dash-cta">
                <span class="dash-cta-plus">+</span>
                Add Listing
              </span>
            </div>
            <div class="mockup-caption">↑ The <strong>Add Listing</strong> button on your dashboard Overview</div>
          </div>

          <p class="step-desc" style="margin-bottom: 22px;">
            Either way takes you to the same 3-step form: <strong>property details → photos & documents → review</strong>. Your listing goes live as <em>Pending Review</em> first; once our team approves it (usually within 24 hours) it becomes ACTIVE and starts appearing in buyer searches.
          </p>
          <a href="${ADD_PROPERTY_URL}" class="cta">Add a Property →</a>

          <hr class="divider">

          <p class="closing">
            Stuck on either step? Reply to this email — it goes straight to our team.
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

Thanks again for joining PropertyLoop. Your account is set up — let's finish two quick things so buyers can find you and your listings.

STEP 1 — Complete your profile in Settings
A complete profile (photo, agency name, location, bio) makes your listings noticeably more credible. It takes about a minute.
Open Settings: ${SETTINGS_URL}

STEP 2 — Add your first property
From any page, click "Add Property" in the top navbar.
Or, from your Agent Dashboard Overview, tap the green "Add Listing" button in the top-right.
Both take you to the same 3-step form (property details → photos & documents → review). Your listing goes live as Pending Review first; once approved (usually within 24 hours) it becomes ACTIVE.

Add a Property: ${ADD_PROPERTY_URL}
Or open the dashboard: ${DASHBOARD_URL}

Stuck? Reply to this email — it goes straight to our team.

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
      subject: 'Finish setting up your PropertyLoop profile + add your first listing',
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
