/**
 * Send pre-filled signup invites to every REAL_ESTATE_AGENT on the waitlist
 * who has NOT yet signed up (no matching User row by email, case-insensitive).
 *
 * This naturally re-includes anyone from the original "curated 23" who never
 * activated, plus everyone else on the agent waitlist beyond that batch.
 *
 * Usage:
 *   # Send a single test email (uses the FIRST eligible recipient's token)
 *   npx ts-node scripts/send-pending-agent-onboarding.ts --test=you@example.com
 *
 *   # Real broadcast
 *   npx ts-node scripts/send-pending-agent-onboarding.ts --send
 *
 *   # Preview without calling Resend
 *   npx ts-node scripts/send-pending-agent-onboarding.ts --dry-run
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
      '  --send                   (broadcast to all pending agents)\n' +
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

// ─── Email template (agent-specific) ────────────────────────────────────
function emailHtml(opts: { firstName: string; inviteUrl: string }) {
  const { firstName, inviteUrl } = opts;
  const friendly = firstName ? `Hi ${firstName},` : 'Hi there,';

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Your PropertyLoop invite</title>
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
            <p style="margin:0 0 12px;font-size:14px;color:#1f6f43;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;">You're in</p>
            <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#1a3d2a;font-weight:700;">${friendly}</h1>
            <p style="margin:0 0 16px;font-size:15px;color:#2d5a3f;">PropertyLoop is now live, and your spot from the waitlist has been reserved. As a real estate agent, you can list properties, manage viewings, and reach buyers across Nigeria.</p>
            <p style="margin:0 0 24px;font-size:15px;color:#2d5a3f;">Tap the button below to set a password and finish setting up your account. Your details are already pre-filled.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 36px 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="border-radius:999px;background-color:#1f6f43;">
                  <a href="${inviteUrl}" style="display:inline-block;padding:14px 28px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;">Activate your agent account →</a>
                </td>
              </tr>
            </table>
            <p style="margin:18px 0 0;font-size:12px;color:#6b7d72;line-height:1.5;">Or copy and paste this link into your browser:<br/><a href="${inviteUrl}" style="color:#1f6f43;word-break:break-all;">${inviteUrl}</a></p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 36px 32px;">
            <div style="background-color:rgba(31,111,67,0.04);border:1px solid rgba(31,111,67,0.12);border-radius:12px;padding:16px 18px;">
              <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#1a3d2a;">A heads-up before you sign up</p>
              <p style="margin:0;font-size:12px;color:#4a7a5c;line-height:1.5;">During signup you'll be asked for your <strong>company registration number</strong> (CAC RC number or equivalent professional registration). It's required to activate an agent account — please have it ready.</p>
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
            <p style="margin:0;font-size:12px;color:#6b7d72;">Need help? Reach us at <a href="mailto:support.propertyloop@propertyloop.ng" style="color:#1f6f43;">support.propertyloop@propertyloop.ng</a></p>
          </td>
        </tr>
      </table>
      <p style="text-align:center;margin:18px 0 0;font-size:11px;color:#8d9a92;">© ${new Date().getFullYear()} PropertyLoop · Lagos, Nigeria</p>
    </div>
  </body>
</html>`;
}

function plainText(opts: { firstName: string; inviteUrl: string }) {
  return [
    `Hi ${opts.firstName || 'there'},`,
    '',
    'PropertyLoop is now live, and your spot from the waitlist has been reserved.',
    'As a real estate agent, you can list properties, manage viewings, and reach buyers across Nigeria.',
    '',
    `Activate your agent account: ${opts.inviteUrl}`,
    '',
    'Heads up: during signup you will be asked for your company registration number (CAC RC number or equivalent). It is required — please have it ready.',
    '',
    'This invite is unique to you and expires in 90 days.',
    '',
    'Need help? support.propertyloop@propertyloop.ng',
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
};

async function buildRecipients(): Promise<Recipient[]> {
  const [waitlistAgents, users] = await Promise.all([
    prisma.waitlistEntry.findMany({
      where: { type: 'REAL_ESTATE_AGENT' },
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
  for (const entry of waitlistAgents) {
    if (signedUpEmails.has(entry.email.trim().toLowerCase())) continue;

    const fullName = `${entry.first_name ?? ''} ${entry.last_name ?? ''}`.trim();
    const token = jwt.sign(
      {
        wlId: entry.id,
        name: fullName,
        email: entry.email,
        phone: entry.phone,
        location: entry.location ?? '',
        role: 'agent',
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
    });
  }

  return recipients;
}

// ─── Send loop ──────────────────────────────────────────────────────────
async function sendOne(r: Recipient, deliverTo?: string) {
  const to = deliverTo || r.email;
  const html = emailHtml({ firstName: r.firstName, inviteUrl: r.inviteUrl });
  const text = plainText({ firstName: r.firstName, inviteUrl: r.inviteUrl });
  const subject = "You're in — activate your PropertyLoop agent account";

  if (dryRun) {
    console.log(`[dry-run] would send to ${to} (wlId=${r.wlId})`);
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
  console.log(`Resolved ${recipients.length} pending agent recipients.\n`);

  if (testEmail) {
    const sample = recipients[0];
    if (!sample) {
      console.error('No eligible recipients to build a test from.');
      return;
    }
    console.log(
      `Sending TEST email to ${testEmail} using ${sample.fullName}'s token (wlId=${sample.wlId})...`,
    );
    const res = await sendOne(sample, testEmail);
    if (res.ok)
      console.log('✓ Test sent. Open the email and verify the link pre-fills the form.');
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
    `pending-agent-onboarding-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`,
  );
  const logLines = ['timestamp,email,wlId,result,error'];

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
      logLines.push(`${ts},${r.email},${r.wlId},ok,`);
    } else {
      failCount++;
      const errMsg = (res as any).error || 'unknown';
      console.log(`failed ✗  ${errMsg}`);
      logLines.push(
        `${ts},${r.email},${r.wlId},error,"${errMsg.replace(/"/g, '""')}"`,
      );
    }
    // Resend free tier ≈10 req/sec. 600ms keeps us well below.
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
