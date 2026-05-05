/**
 * Send a gentle follow-up nudge to every waitlist entry that:
 *   • hasn't been activated yet, and
 *   • has no matching User row by email (case-insensitive).
 *
 * Targets REAL_ESTATE_AGENT, BUILDER, and BUILDING_MATERIALS_SUPPLIER_INSTALLER.
 * Skips PARTNER_INVESTOR (different audience, not onboarding-shaped).
 *
 * Copy is tuned per-type so agents and trade vendors don't get identical text.
 * Each recipient gets a freshly-signed JWT activation token in the link.
 *
 * Usage:
 *   # Test — send a single email to the first eligible recipient's link
 *   npx ts-node scripts/send-waitlist-followup.ts --test=you@example.com
 *
 *   # Real broadcast
 *   npx ts-node scripts/send-waitlist-followup.ts --send
 *
 *   # Preview without calling Resend
 *   npx ts-node scripts/send-waitlist-followup.ts --dry-run
 *
 * Required env (loaded from backend/.env):
 *   DATABASE_URL
 *   WAITLIST_TOKEN_SECRET
 *   RESEND_API_KEY
 *   MAIL_FROM
 *   FRONTEND_URL
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
      '  --send                   (broadcast to all unactivated waitlist)\n' +
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

// ─── Per-type framing ───────────────────────────────────────────────────
type WlType = 'REAL_ESTATE_AGENT' | 'BUILDER' | 'BUILDING_MATERIALS_SUPPLIER_INSTALLER';

function tradeNoun(type: WlType): string {
  if (type === 'REAL_ESTATE_AGENT') return 'real estate agent';
  if (type === 'BUILDER') return 'builder';
  return 'building-materials supplier or installer';
}

function jwtRole(type: WlType): 'agent' | 'vendor' {
  return type === 'REAL_ESTATE_AGENT' ? 'agent' : 'vendor';
}

function whatsNewLines(type: WlType): string[] {
  if (type === 'REAL_ESTATE_AGENT') {
    return [
      'A 3-step "Add Property" flow that uploads photos, documents, and a video walkthrough in under 5 minutes',
      'Direct messaging with buyers right from the listing page',
      'A logbook trail on every property — every repair, every record, kept permanently',
    ];
  }
  // Both vendor types share the same trade-vendor pitch
  return [
    'A vendor profile that gets you found by buyers and homeowners looking for your trade',
    'A portfolio gallery for past work and product photos',
    'In-platform messaging so leads don\'t get lost across WhatsApp / SMS / email',
  ];
}

// ─── Email template ─────────────────────────────────────────────────────
function emailHtml(opts: {
  firstName: string;
  inviteUrl: string;
  type: WlType;
}) {
  const { firstName, inviteUrl, type } = opts;
  const friendly = firstName ? `Hi ${firstName},` : 'Hi there,';
  const noun = tradeNoun(type);
  const whatsNew = whatsNewLines(type);

  const newRows = whatsNew
    .map(
      (n) => `
        <tr>
          <td style="padding:6px 0 6px 0;font-size:14px;color:#374151;line-height:1.55;vertical-align:top;width:18px;">
            <span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:#1f6f43;margin-top:8px;"></span>
          </td>
          <td style="padding:6px 0 6px 8px;font-size:14px;color:#374151;line-height:1.55;">
            ${n}
          </td>
        </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Your PropertyLoop activation link is still active</title>
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
            <p style="margin:0 0 12px;font-size:13px;color:#1f6f43;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;">Just a quick nudge</p>
            <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#1a3d2a;font-weight:700;">${friendly}</h1>
            <p style="margin:0 0 16px;font-size:15px;color:#2d5a3f;">
              You joined the PropertyLoop waitlist as ${noun}, and we sent you an activation link a couple of days ago. We noticed you haven't set up your account yet — no pressure, just wanted to make sure the email didn't get lost in your inbox.
            </p>
            <p style="margin:0 0 16px;font-size:15px;color:#2d5a3f;">
              Your spot is still reserved, and the link below is still valid. It pre-fills your name, email, and phone — you only need to set a password.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 36px 24px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="border-radius:999px;background-color:#1f6f43;">
                  <a href="${inviteUrl}" style="display:inline-block;padding:14px 28px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;">Activate your account →</a>
                </td>
              </tr>
            </table>
            <p style="margin:14px 0 0;font-size:12px;color:#6b7d72;line-height:1.5;">Or copy and paste this link:<br/><a href="${inviteUrl}" style="color:#1f6f43;word-break:break-all;">${inviteUrl}</a></p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 36px 28px;">
            <div style="background-color:rgba(31,111,67,0.04);border:1px solid rgba(31,111,67,0.12);border-radius:12px;padding:16px 18px;">
              <p style="margin:0 0 10px;font-size:13px;font-weight:600;color:#1a3d2a;">What's been added since your first invite</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
                ${newRows}
              </table>
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:0 36px 28px;">
            <p style="margin:0;font-size:13px;color:#4a7a5c;line-height:1.6;">If you've changed your mind or this isn't the right time, no problem — just ignore this email and we won't send another reminder. The link expires in 90 days.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 36px 32px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#6b7d72;">Questions? Reply to this email — it goes straight to our team.</p>
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
  type: WlType;
}) {
  const lines: string[] = [
    `Hi ${opts.firstName || 'there'},`,
    '',
    `You joined the PropertyLoop waitlist as ${tradeNoun(opts.type)}, and we sent you an activation link a couple of days ago. We noticed you haven't set up your account yet — no pressure, just wanted to make sure the email didn't get lost in your inbox.`,
    '',
    'Your spot is still reserved, and the link below is still valid. It pre-fills your name, email, and phone — you only need to set a password.',
    '',
    `Activate your account: ${opts.inviteUrl}`,
    '',
    "What's been added since your first invite:",
  ];
  for (const n of whatsNewLines(opts.type)) lines.push(`  • ${n}`);
  lines.push(
    '',
    "If you've changed your mind or this isn't the right time, no problem — just ignore this email and we won't send another reminder. The link expires in 90 days.",
    '',
    'Questions? Reply to this email.',
    '',
    '— PropertyLoop',
  );
  return lines.join('\n');
}

// ─── Recipient resolution ───────────────────────────────────────────────
type Recipient = {
  email: string;
  firstName: string;
  fullName: string;
  inviteUrl: string;
  wlId: string;
  type: WlType;
};

async function buildRecipients(): Promise<Recipient[]> {
  const TARGET_TYPES: WlType[] = [
    'REAL_ESTATE_AGENT',
    'BUILDER',
    'BUILDING_MATERIALS_SUPPLIER_INSTALLER',
  ];

  const [waitlist, users] = await Promise.all([
    prisma.waitlistEntry.findMany({
      where: {
        activated: false,
        type: { in: TARGET_TYPES },
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
  for (const entry of waitlist) {
    if (signedUpEmails.has(entry.email.trim().toLowerCase())) continue;

    const fullName =
      `${entry.first_name ?? ''} ${entry.last_name ?? ''}`.trim();
    const token = jwt.sign(
      {
        wlId: entry.id,
        name: fullName,
        email: entry.email,
        phone: entry.phone,
        location: entry.location ?? '',
        role: jwtRole(entry.type as WlType),
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
      type: entry.type as WlType,
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
    type: r.type,
  });
  const text = plainText({
    firstName: r.firstName,
    inviteUrl: r.inviteUrl,
    type: r.type,
  });
  const subject =
    r.type === 'REAL_ESTATE_AGENT'
      ? 'Your PropertyLoop agent activation link is still active'
      : 'Your PropertyLoop vendor activation link is still active';

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const recipients = await buildRecipients();
  console.log(`Resolved ${recipients.length} unactivated waitlist recipients.\n`);

  // Per-type breakdown for visibility
  const byType: Record<string, number> = {};
  for (const r of recipients) byType[r.type] = (byType[r.type] ?? 0) + 1;
  for (const [t, n] of Object.entries(byType)) {
    console.log(`  ${t.padEnd(40)}  ${n}`);
  }
  console.log('');

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
      console.log('✓ Test sent. Open the email and verify the link pre-fills the form.');
    else console.error('✗ Test failed:', (res as any).error);
    return;
  }

  if (recipients.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  const outDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const logPath = path.join(
    outDir,
    `waitlist-followup-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`,
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
