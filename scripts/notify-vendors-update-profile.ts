/**
 * One-shot: email every registered vendor asking them to complete their
 * profile (avatar, banner, portfolio).
 *
 *   npx ts-node scripts/notify-vendors-update-profile.ts            # dry run, lists recipients
 *   npx ts-node scripts/notify-vendors-update-profile.ts --send     # actually sends
 *   npx ts-node scripts/notify-vendors-update-profile.ts --send --only-incomplete
 *       # only emails vendors missing banner OR portfolio
 */
import 'dotenv/config';
import { Resend } from 'resend';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../generated/prisma/client';

const send = process.argv.includes('--send');
const onlyIncomplete = process.argv.includes('--only-incomplete');

const LOGO_URL =
  'https://image2url.com/r2/default/images/1774405533651-13ef5a22-bfcb-4d8e-801e-563f4451c8b0.png';

function getDashboardUrl(): string {
  // Force production URL for this outbound notification regardless of local
  // FRONTEND_URL (which may point at localhost during dev).
  return 'https://propertyloop.ng/vendor-dashboard';
}

function emailHtml(firstName: string, dashboardUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Complete your PropertyLoop vendor profile</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background-color: #f4f4f5; color: #111827; line-height: 1.6; -webkit-font-smoothing: antialiased; }
      .wrapper { background-color: #f4f4f5; padding: 40px 16px; }
      .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; border: 1px solid #e5e7eb; overflow: hidden; }
      .header { background-color: #0f1f14; padding: 36px 48px; text-align: left; }
      .header img { height: 36px; width: auto; display: block; }
      .divider-green { height: 3px; background-color: #2f9e61; }
      .content { padding: 48px; }
      .greeting { font-size: 22px; font-weight: 600; color: #111827; margin-bottom: 16px; letter-spacing: -0.3px; }
      .body-text { font-size: 15px; color: #4b5563; line-height: 1.75; margin-bottom: 28px; }
      .section-label { font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #2f9e61; margin-bottom: 16px; }
      .step-list { margin-bottom: 32px; counter-reset: step; }
      .step-row { display: flex; align-items: flex-start; padding: 14px 0; border-bottom: 1px solid #f3f4f6; }
      .step-row:last-child { border-bottom: none; }
      .step-num { width: 26px; height: 26px; border-radius: 50%; background-color: #0f1f14; color: #ffffff; font-size: 12px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; margin-right: 14px; flex-shrink: 0; }
      .step-content { flex: 1; }
      .step-title { font-size: 14px; font-weight: 600; color: #111827; margin-bottom: 2px; }
      .step-desc { font-size: 13px; color: #6b7280; line-height: 1.6; }
      .cta-wrap { text-align: center; margin: 8px 0 32px; }
      .cta { display: inline-block; background-color: #2f9e61; color: #ffffff !important; text-decoration: none; padding: 14px 28px; border-radius: 6px; font-size: 14px; font-weight: 600; letter-spacing: 0.2px; }
      .checklist { background-color: #f9fafb; border: 1px solid #f3f4f6; border-radius: 6px; padding: 20px 24px; margin-bottom: 32px; }
      .checklist-title { font-size: 12px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: #111827; margin-bottom: 12px; }
      .checklist-item { font-size: 13px; color: #4b5563; padding: 6px 0; }
      .checklist-item:before { content: "✓ "; color: #2f9e61; font-weight: 700; margin-right: 6px; }
      .divider { border: none; border-top: 1px solid #f3f4f6; margin: 24px 0; }
      .closing { font-size: 14px; color: #4b5563; line-height: 1.7; margin-bottom: 24px; }
      .signature-name { font-size: 14px; font-weight: 600; color: #111827; }
      .signature-title { font-size: 13px; color: #6b7280; }
      .footer { background-color: #0f1f14; padding: 32px 48px; text-align: center; }
      .footer-logo { margin-bottom: 14px; }
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
        <div class="header"><img src="${LOGO_URL}" alt="PropertyLoop"></div>
        <div class="divider-green"></div>

        <div class="content">
          <div class="greeting">Hi ${firstName},</div>

          <p class="body-text">
            Buyers on PropertyLoop are far more likely to hire vendors with a complete profile, a banner image, and real photos of past work. Take a few minutes to finish setting up your profile so prospective clients can see what you bring to the table.
          </p>

          <div class="section-label">How to update your profile</div>
          <div class="step-list">
            <div class="step-row">
              <div class="step-num">1</div>
              <div class="step-content">
                <div class="step-title">Sign in to your vendor dashboard</div>
                <div class="step-desc">Open propertyloop.ng and log in with the email you registered with.</div>
              </div>
            </div>
            <div class="step-row">
              <div class="step-num">2</div>
              <div class="step-content">
                <div class="step-title">Open the Settings tab</div>
                <div class="step-desc">In the left sidebar, click <strong>Settings</strong>. This is where your profile lives.</div>
              </div>
            </div>
            <div class="step-row">
              <div class="step-num">3</div>
              <div class="step-content">
                <div class="step-title">Upload your profile picture &amp; banner</div>
                <div class="step-desc">Click <strong>Profile Picture</strong> to upload a clear headshot, then click <strong>Profile Banner</strong> to upload a wide hero image (a photo of your workshop, a finished project, or your team works well).</div>
              </div>
            </div>
            <div class="step-row">
              <div class="step-num">4</div>
              <div class="step-content">
                <div class="step-title">Add your portfolio</div>
                <div class="step-desc">Scroll down to <strong>Portfolio &amp; Past Work</strong> and upload photos of jobs you've completed. The more real work you show, the more likely buyers are to book you.</div>
              </div>
            </div>
            <div class="step-row">
              <div class="step-num">5</div>
              <div class="step-content">
                <div class="step-title">Fill in your details</div>
                <div class="step-desc">Confirm your service category, years of experience, service area, price range, and a short bio so clients know exactly what you offer.</div>
              </div>
            </div>
          </div>

          <div class="cta-wrap">
            <a href="${dashboardUrl}" class="cta">Open my vendor dashboard</a>
          </div>

          <div class="checklist">
            <div class="checklist-title">Quick checklist</div>
            <div class="checklist-item">Profile picture (clear headshot)</div>
            <div class="checklist-item">Banner image (wide hero photo)</div>
            <div class="checklist-item">At least 3 portfolio photos of past work</div>
            <div class="checklist-item">Service category, area, and price</div>
            <div class="checklist-item">Short bio describing what you do</div>
          </div>

          <hr class="divider">

          <p class="closing">
            Questions or stuck somewhere? Just reply to this email — we read every message.
          </p>

          <div>
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
}

function emailText(firstName: string, dashboardUrl: string): string {
  return `Hi ${firstName},

Buyers on PropertyLoop are far more likely to hire vendors with a complete profile, a banner image, and real photos of past work. Take a few minutes to finish setting up your profile.

How to update your profile:

1. Sign in to your vendor dashboard at propertyloop.ng.
2. Open the Settings tab in the left sidebar.
3. Upload your Profile Picture and your Profile Banner (a wide hero image — your workshop, a finished project, or your team).
4. Scroll down to Portfolio & Past Work and upload photos of jobs you have completed.
5. Confirm your service category, years of experience, service area, price range, and a short bio.

Quick checklist:
  - Profile picture (clear headshot)
  - Banner image (wide hero photo)
  - At least 3 portfolio photos of past work
  - Service category, area, and price
  - Short bio describing what you do

Open your dashboard: ${dashboardUrl}

Questions or stuck somewhere? Reply to this email — we read every message.

— The PropertyLoop Team
propertyloop.ng`;
}

async function main() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (send && !apiKey) throw new Error('RESEND_API_KEY is not set');
  if (send && !from) throw new Error('MAIL_FROM is not set');

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');

  const pool = new Pool({ connectionString: databaseUrl });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter } as any);

  const resend = send ? new Resend(apiKey!) : null;
  const dashboardUrl = getDashboardUrl();

  console.log(send ? '── SENDING ──' : '── DRY RUN (pass --send to email) ──');
  console.log('Dashboard URL:', dashboardUrl);
  if (onlyIncomplete) console.log('Filter: only vendors missing banner OR portfolio');
  console.log();

  const vendors = await prisma.user.findMany({
    where: { role: 'VENDOR' as any, isActive: true as any },
    select: {
      id: true,
      name: true,
      email: true,
      vendorProfile: { select: { bannerImage: true, portfolioImages: true } },
    },
  });

  let sentCount = 0;
  let skippedCount = 0;
  const failures: { email: string; error: string }[] = [];

  for (const v of vendors) {
    const profile = v.vendorProfile;
    const hasBanner = !!profile?.bannerImage;
    const hasPortfolio = (profile?.portfolioImages?.length ?? 0) > 0;
    const incomplete = !hasBanner || !hasPortfolio;

    if (onlyIncomplete && !incomplete) {
      skippedCount++;
      continue;
    }

    const firstName = (v.name || '').trim().split(/\s+/)[0] || 'there';

    console.log(
      `${incomplete ? '✗' : '✓'} ${v.email.padEnd(40)} ` +
        `banner=${hasBanner ? 'yes' : 'no '}  portfolio=${profile?.portfolioImages?.length ?? 0}`,
    );

    if (!send) continue;

    try {
      await resend!.emails.send({
        from: from!,
        to: v.email,
        subject: 'Finish setting up your PropertyLoop vendor profile',
        html: emailHtml(firstName, dashboardUrl),
        text: emailText(firstName, dashboardUrl),
      });
      sentCount++;
      // Polite throttle so we don't trip Resend rate limits
      await new Promise((r) => setTimeout(r, 500));
    } catch (err: any) {
      failures.push({ email: v.email, error: err?.message ?? String(err) });
    }
  }

  console.log();
  console.log(
    `Total vendors: ${vendors.length}` +
      (onlyIncomplete ? `  skipped(complete): ${skippedCount}` : ''),
  );
  if (send) {
    console.log(`Sent: ${sentCount}   Failed: ${failures.length}`);
    for (const f of failures) console.log(`  ! ${f.email} — ${f.error}`);
  } else {
    console.log('Pass --send to actually email these vendors.');
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
