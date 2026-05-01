/**
 * One-off: notify Paul that his PropertyLoop account is now a Vendor
 * (Light Fittings) instead of an Agent.
 *
 * Usage:
 *   npx ts-node scripts/send-paul-vendor-conversion-email.ts
 */

import 'dotenv/config';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.MAIL_FROM!;
const TO = 'paulukbrand@gmail.com';
const NAME = 'Paul';

const LOGO_URL =
  'https://image2url.com/r2/default/images/1774405533651-13ef5a22-bfcb-4d8e-801e-563f4451c8b0.png';

const SETTINGS_URL = 'https://www.propertyloop.ng/settings';
const DASHBOARD_URL = 'https://www.propertyloop.ng/dashboard';

const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Your PropertyLoop account has been updated</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
        background-color: #f4f4f5;
        color: #111827;
        line-height: 1.6;
      }
      .wrapper { background-color: #f4f4f5; padding: 40px 16px; }
      .container {
        max-width: 600px; margin: 0 auto; background-color: #ffffff;
        border-radius: 8px; border: 1px solid #e5e7eb; overflow: hidden;
      }
      .header { background-color: #0f1f14; padding: 36px 48px; }
      .header img { height: 36px; display: block; }
      .divider-green { height: 3px; background-color: #2f9e61; }
      .content { padding: 44px 48px; }
      .greeting {
        font-size: 22px; font-weight: 600; color: #111827; margin-bottom: 14px;
        letter-spacing: -0.3px;
      }
      .body-text {
        font-size: 15px; color: #4b5563; line-height: 1.75; margin-bottom: 22px;
      }
      .summary-card {
        background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px;
        padding: 20px 22px; margin: 22px 0;
      }
      .summary-row {
        display: flex; justify-content: space-between; padding: 6px 0;
        font-size: 14px; gap: 12px; flex-wrap: wrap;
      }
      .summary-label { color: #6b7280; font-weight: 500; }
      .summary-value { color: #111827; font-weight: 600; }
      .cta-block { margin: 28px 0 8px; text-align: center; }
      .cta {
        display: inline-block; background-color: #2f9e61; color: #ffffff !important;
        font-size: 14.5px; font-weight: 600; text-decoration: none;
        padding: 12px 28px; border-radius: 6px; letter-spacing: 0.2px;
      }
      .section-label {
        font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;
        color: #2f9e61; margin: 26px 0 10px;
      }
      ul.next-steps { list-style: none; padding: 0; margin: 0 0 22px; }
      ul.next-steps li {
        font-size: 14px; color: #4b5563; line-height: 1.65;
        padding: 6px 0 6px 22px; position: relative;
      }
      ul.next-steps li::before {
        content: ""; width: 6px; height: 6px; border-radius: 50%; background: #2f9e61;
        position: absolute; left: 4px; top: 13px;
      }
      .divider {
        border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;
      }
      .closing { font-size: 14.5px; color: #4b5563; line-height: 1.7; }
      .signature { margin-top: 22px; }
      .signature-name { font-size: 14px; font-weight: 600; color: #111827; }
      .signature-title { font-size: 13px; color: #9ca3af; margin-top: 2px; }
      .footer {
        background-color: #f9fafb; border-top: 1px solid #e5e7eb;
        padding: 26px 48px; text-align: center;
      }
      .footer-logo img { height: 24px; opacity: 0.6; }
      .footer-copy { font-size: 11px; color: #d1d5db; margin-top: 12px; }
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
        <div class="header"><img src="${LOGO_URL}" alt="PropertyLoop"></div>
        <div class="divider-green"></div>
        <div class="content">
          <div class="greeting">Hi ${NAME},</div>

          <p class="body-text">
            A quick note: your PropertyLoop account has been updated. You're now registered as a <strong>Service Vendor</strong> rather than a Real Estate Agent — better aligned with your business of supplying light fittings.
          </p>

          <div class="summary-card">
            <div class="summary-row">
              <span class="summary-label">Account type</span>
              <span class="summary-value">Service Vendor</span>
            </div>
            <div class="summary-row">
              <span class="summary-label">Service category</span>
              <span class="summary-value">Light Fittings</span>
            </div>
            <div class="summary-row">
              <span class="summary-label">Service area</span>
              <span class="summary-value">Lagos</span>
            </div>
            <div class="summary-row">
              <span class="summary-label">Login email</span>
              <span class="summary-value">${TO}</span>
            </div>
          </div>

          <p class="body-text">
            Your login credentials are unchanged — you sign in with the same email and password as before. Buyers looking for light fittings, lighting installations, or related services will now be able to find and message you through PropertyLoop.
          </p>

          <div class="section-label">A few things to do next</div>
          <ul class="next-steps">
            <li>Visit <strong>Settings</strong> to add your bio, years of experience, and service area details so your profile looks complete to potential clients.</li>
            <li>Upload a banner image and a few portfolio shots of your work — vendors with portfolios get noticeably more enquiries.</li>
            <li>If you'd like a verified badge on your profile, reply to this email and our team will guide you through the KYC step.</li>
          </ul>

          <div class="cta-block">
            <a href="${SETTINGS_URL}" class="cta">Open Settings →</a>
          </div>

          <hr class="divider">

          <p class="closing">
            Questions, or want to revert this change? Just reply to this email — it goes straight to our team.
          </p>

          <div class="signature">
            <div class="signature-name">The PropertyLoop Team</div>
            <div class="signature-title">propertyloop.ng</div>
          </div>
        </div>
        <div class="footer">
          <div class="footer-logo"><img src="${LOGO_URL}" alt="PropertyLoop"></div>
          <div class="footer-copy">&copy; 2026 PropertyLoop. All rights reserved.</div>
        </div>
      </div>
    </div>
  </body>
</html>`;

const text = `Hi ${NAME},

A quick note: your PropertyLoop account has been updated. You're now
registered as a Service Vendor rather than a Real Estate Agent — better
aligned with your business of supplying light fittings.

Account summary:
  • Account type:     Service Vendor
  • Service category: Light Fittings
  • Service area:     Lagos
  • Login email:      ${TO}

Your login credentials are unchanged — you sign in with the same email
and password as before. Buyers looking for light fittings, lighting
installations, or related services will now be able to find and message
you through PropertyLoop.

A few things to do next:
  • Visit Settings to add your bio, years of experience, and service area
    details so your profile looks complete to potential clients.
  • Upload a banner image and a few portfolio shots of your work — vendors
    with portfolios get noticeably more enquiries.
  • If you'd like a verified badge on your profile, reply to this email
    and our team will guide you through the KYC step.

Open Settings: ${SETTINGS_URL}
Or your dashboard: ${DASHBOARD_URL}

Questions, or want to revert this change? Just reply to this email — it
goes straight to our team.

— The PropertyLoop Team
propertyloop.ng`;

async function main() {
  if (!process.env.RESEND_API_KEY) {
    console.error('ERROR: RESEND_API_KEY not set');
    process.exit(1);
  }
  if (!FROM) {
    console.error('ERROR: MAIL_FROM not set');
    process.exit(1);
  }

  await resend.emails.send({
    from: FROM,
    to: TO,
    subject: 'Your PropertyLoop account has been updated to a Vendor',
    html,
    text,
  });

  console.log(`✓ Sent to ${TO}`);
}

main().catch((err) => {
  console.error('✗ Failed:', err?.message ?? err);
  process.exit(1);
});
