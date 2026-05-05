/**
 * Send pre-filled signup invites to every BUILDER + BUILDING_MATERIALS_SUPPLIER_INSTALLER
 * on the waitlist who has NOT yet signed up (no matching User row by email,
 * case-insensitive). This is the activation follow-up to the "we've cooked"
 * warmup that just went out.
 *
 * Mirrors send-pending-agent-onboarding.ts but emits vendor-role tokens
 * (role='vendor' in the JWT payload, which the frontend's /onboarding
 * pre-fill resolves to the vendor track).
 *
 * Usage:
 *   # Send a single test email (uses the FIRST eligible recipient's token)
 *   npx ts-node scripts/send-pending-vendor-onboarding.ts --test=you@example.com
 *
 *   # Real broadcast
 *   npx ts-node scripts/send-pending-vendor-onboarding.ts --send
 *
 *   # Preview without calling Resend
 *   npx ts-node scripts/send-pending-vendor-onboarding.ts --dry-run
 *
 * Required env (loaded from backend/.env):
 *   DATABASE_URL
 *   WAITLIST_TOKEN_SECRET    (must match the deployed backend's value)
 *   RESEND_API_KEY
 *   MAIL_FROM                e.g. "PropertyLoop <noreply@propertyloop.ng>"
 *   FRONTEND_URL             e.g. https://www.propertyloop.ng
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as jwt from 'jsonwebtoken';
import { Resend } from 'resend';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

// ─── Args ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const broadcast = args.includes('--send');
const testArg = args.find((a) => a.startsWith('--test='));
const testEmail = testArg ? testArg.split('=')[1] : null;

if (!broadcast && !testEmail && !dryRun) {
  console.error(
    'You must pass exactly one of:\n' +
      '  --test=you@example.com   (send one test email)\n' +
      '  --send                   (broadcast to all pending vendors)\n' +
      '  --dry-run                (preview without sending)\n',
  );
  process.exit(1);
}

// ─── Env ────────────────────────────────────────────────────────────────
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not set');

const tokenSecret = process.env.WAITLIST_TOKEN_SECRET;
if (!tokenSecret) {
  console.error(
    '✗ WAITLIST_TOKEN_SECRET is not set. Refusing to generate tokens — they would not verify against the backend.',
  );
  process.exit(1);
}

const resendKey = process.env.RESEND_API_KEY;
if (!dryRun && !resendKey) {
  console.error('✗ RESEND_API_KEY is not set');
  process.exit(1);
}

const mailFrom =
  process.env.MAIL_FROM || 'PropertyLoop <noreply@propertyloop.ng>';
const frontendUrl = (
  process.env.FRONTEND_URL || 'https://www.propertyloop.ng'
).replace(/\/+$/, '');

const LOGO_URL =
  'https://image2url.com/r2/default/images/1774405533651-13ef5a22-bfcb-4d8e-801e-563f4451c8b0.png';

const resend = resendKey ? new Resend(resendKey) : null;
const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter } as any);

// Friendly trade label per waitlist type
const TRADE_LABEL: Record<string, string> = {
  BUILDER: 'a builder',
  BUILDING_MATERIALS_SUPPLIER_INSTALLER:
    'a building-materials supplier or installer',
};

// ─── Email template (vendor-specific) ───────────────────────────────────
function emailHtml(opts: {
  firstName: string;
  inviteUrl: string;
  trade: string;
}) {
  const { firstName, inviteUrl, trade } = opts;
  const friendly = firstName ? `Hi ${firstName},` : 'Hi there,';

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Activate your PropertyLoop vendor account</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f5f0eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a3d2a;line-height:1.6;">
    <div style="background-color:#f5f0eb;padding:40px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto;background-color:#ffffff;border-radius:16px;border:1px solid rgba(31,111,67,0.15);overflow:hidden;">
        <tr>
          <td style="padding:32px 36px 24px;text-align:center;border-bottom:1px solid rgba(31,111,67,0.08);">
            <img src="${LOGO_URL}" alt="PropertyLoop" width="160" style="max-width:160px;height:auto;display:inline-block;" />
          </td>
        </tr>
        <tr>
          <td style="padding:32px 36px 8px;">
            <p style="margin:0 0 12px;font-size:14px;color:#1f6f43;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;">As promised — you're in</p>
            <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#1a3d2a;font-weight:700;">${friendly}</h1>
            <p style="margin:0 0 16px;font-size:15px;color:#2d5a3f;">PropertyLoop is open to you. You joined the waitlist as ${trade}, and your spot has been reserved — you're among the very first vendors we're letting in.</p>
            <p style="margin:0 0 16px;font-size:15px;color:#2d5a3f;">As a vendor on PropertyLoop, you'll get a public profile that buyers and homeowners can find when they need your trade, message you directly through the platform, and pay safely once a job is done.</p>
            <p style="margin:0 0 24px;font-size:15px;color:#2d5a3f;">Tap the button below to set a password and finish setting up your account. Your details are already pre-filled.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 36px 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="border-radius:999px;background-color:#1f6f43;">
                  <a href="${inviteUrl}" style="display:inline-block;padding:14px 28px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;">Activate your vendor account →</a>
                </td>
              </tr>
            </table>
            <p style="margin:18px 0 0;font-size:12px;color:#6b7d72;line-height:1.5;">Or copy and paste this link into your browser:<br/><a href="${inviteUrl}" style="color:#1f6f43;word-break:break-all;">${inviteUrl}</a></p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 36px 16px;">
            <div style="background-color:rgba(31,111,67,0.04);border:1px solid rgba(31,111,67,0.12);border-radius:12px;padding:16px 18px;">
              <p style="margin:0 0 10px;font-size:13px;font-weight:600;color:#1a3d2a;">What you'll be asked for during signup</p>
              <ul style="margin:0;padding-left:18px;font-size:12px;color:#4a7a5c;line-height:1.65;">
                <li>Your service category (Builder, Electrician, Carpenter, etc. — pick the closest fit)</li>
                <li>Years of experience</li>
                <li>The areas you serve (e.g. "Lekki, Ajah, Victoria Island")</li>
                <li>A password for your account</li>
              </ul>
              <p style="margin:10px 0 0;font-size:12px;color:#4a7a5c;line-height:1.5;">Adding a profile photo and a few portfolio shots after signup makes a big difference — vendors with portfolios get noticeably more enquiries.</p>
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:0 36px 32px;">
            <div style="background-color:rgba(31,111,67,0.04);border:1px solid rgba(31,111,67,0.12);border-radius:12px;padding:16px 18px;">
              <p style="margin:0;font-size:12px;color:#4a7a5c;line-height:1.5;">This invite link is unique to you and expires in 90 days. If you didn't sign up to PropertyLoop's waitlist, you can ignore this email.</p>
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:0 36px 32px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#6b7d72;">Need help? Reach us at <a href="mailto:support@propertyloop.ng" style="color:#1f6f43;">support@propertyloop.ng</a></p>
          </td>
        </tr>
      </table>
      <p style="text-align:center;margin:18px 0 0;font-size:11px;color:#8d9a92;">© ${new Date().getFullYear()} PropertyLoop · Lagos, Nigeria</p>
    </div>
  </body>
</html>`;
}

function plainText(opts: {
  firstName: string;
  inviteUrl: string;
  trade: string;
}) {
  return [
    `Hi ${opts.firstName || 'there'},`,
    '',
    `As promised — PropertyLoop is open to you. You joined the waitlist as ${opts.trade}, and your spot has been reserved.`,
    '',
    'As a vendor on PropertyLoop, you get a public profile that buyers and homeowners can find when they need your trade, message you directly through the platform, and pay safely once a job is done.',
    '',
    `Activate your vendor account: ${opts.inviteUrl}`,
    '',
    'During signup you will be asked for:',
    '  • Your service category (Builder, Electrician, Carpenter, etc.)',
    '  • Years of experience',
    '  • The areas you serve (e.g. "Lekki, Ajah, Victoria Island")',
    '  • A password for your account',
    '',
    'Adding a profile photo and a few portfolio shots after signup makes a big difference — vendors with portfolios get noticeably more enquiries.',
    '',
    'This invite is unique to you and expires in 90 days.',
    '',
    'Need help? support@propertyloop.ng',
    '',
    '— PropertyLoop',
  ].join('\n');
}

// ─── Recipient resolution ───────────────────────────────────────────────
type Recipient = {
  email: string;
  firstName: string;
  fullName: string;
  inviteUrl: string;
  wlId: string;
  trade: string;
  type: string;
};

async function buildRecipients(): Promise<Recipient[]> {
  const [waitlistVendors, users] = await Promise.all([
    prisma.waitlistEntry.findMany({
      where: {
        type: { in: ['BUILDER', 'BUILDING_MATERIALS_SUPPLIER_INSTALLER'] },
      },
      orderBy: { created_at: 'asc' },
    }),
    prisma.user.findMany({
      select: { email: true },
      where: { deletedAt: null },
    }),
  ]);

  const signedUpEmails = new Set(
    users.map((u) => u.email.trim().toLowerCase()),
  );

  const recipients: Recipient[] = [];
  for (const entry of waitlistVendors) {
    if (signedUpEmails.has(entry.email.trim().toLowerCase())) continue;

    const fullName = `${entry.first_name ?? ''} ${entry.last_name ?? ''}`.trim();
    const token = jwt.sign(
      {
        wlId: entry.id,
        name: fullName,
        email: entry.email,
        phone: entry.phone,
        location: entry.location ?? '',
        role: 'vendor',
      },
      tokenSecret!,
      { expiresIn: '90d' },
    );
    const inviteUrl = `${frontendUrl}/onboarding?wl=${token}`;

    recipients.push({
      email: entry.email,
      firstName: entry.first_name?.trim() || '',
      fullName,
      inviteUrl,
      wlId: entry.id,
      trade: TRADE_LABEL[entry.type] ?? 'a service vendor',
      type: entry.type,
    });
  }

  return recipients;
}

// ─── Send loop ──────────────────────────────────────────────────────────
async function sendOne(r: Recipient, deliverTo?: string) {
  const to = deliverTo || r.email;
  const html = emailHtml({
    firstName: r.firstName,
    inviteUrl: r.inviteUrl,
    trade: r.trade,
  });
  const text = plainText({
    firstName: r.firstName,
    inviteUrl: r.inviteUrl,
    trade: r.trade,
  });
  const subject = "It's ready — activate your PropertyLoop vendor account";

  if (dryRun) {
    console.log(`[dry-run] would send to ${to} (wlId=${r.wlId}, type=${r.type})`);
    return { ok: true };
  }

  try {
    await resend!.emails.send({ from: mailFrom, to, subject, html, text });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const recipients = await buildRecipients();
  console.log(`Resolved ${recipients.length} pending vendor recipients.\n`);

  if (testEmail) {
    const sample = recipients[0];
    if (!sample) {
      console.error('No eligible recipients to build a test from.');
      return;
    }
    console.log(
      `Sending TEST email to ${testEmail} using ${sample.fullName}'s token (wlId=${sample.wlId}, type=${sample.type})...`,
    );
    const res = await sendOne(sample, testEmail);
    if (res.ok)
      console.log(
        '✓ Test sent. Open the email and verify the link pre-fills the vendor onboarding form.',
      );
    else console.error('✗ Test failed:', (res as any).error);
    return;
  }

  if (recipients.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  // Persist a snapshot of what was attempted, for audit
  const outDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const logPath = path.join(
    outDir,
    `pending-vendor-onboarding-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`,
  );
  const logLines = ['timestamp,email,wlId,type,result,error'];

  let okCount = 0;
  let failCount = 0;

  for (let i = 0; i < recipients.length; i++) {
    const r = recipients[i];
    process.stdout.write(`(${i + 1}/${recipients.length}) ${r.email}… `);
    const res = await sendOne(r);
    const ts = new Date().toISOString();
    if (res.ok) {
      okCount++;
      console.log(dryRun ? 'DRY' : 'sent ✓');
      logLines.push(`${ts},${r.email},${r.wlId},${r.type},ok,`);
    } else {
      failCount++;
      const errMsg = (res as any).error || 'unknown';
      console.log(`failed ✗  ${errMsg}`);
      logLines.push(
        `${ts},${r.email},${r.wlId},${r.type},error,"${errMsg.replace(/"/g, '""')}"`,
      );
    }
    if (i < recipients.length - 1) await sleep(dryRun ? 0 : 600);
  }

  fs.writeFileSync(logPath, logLines.join('\n') + '\n', 'utf8');
  console.log('\n══════ DONE ══════');
  console.log(`Sent OK : ${okCount}`);
  console.log(`Failed  : ${failCount}`);
  console.log(`Log     : ${logPath}`);
}

main()
  .catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
