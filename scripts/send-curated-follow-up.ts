/**
 * Follow-up email to the 23-name curated waitlist — "getting started" guide.
 * Same recipient resolution as send-curated-23-invites.ts but a different
 * template focused on next steps once they're on the platform.
 *
 * Usage:
 *   npx ts-node scripts/send-curated-follow-up.ts --test=you@example.com --role=agent
 *   npx ts-node scripts/send-curated-follow-up.ts --send --role=agent
 *   npx ts-node scripts/send-curated-follow-up.ts --dry-run --role=agent
 *
 * Optional:
 *   --only-pending     skip recipients who have already activated
 *
 * The email includes the recipient's personal invite link as a backup,
 * so it still works for people who haven't activated yet — they can
 * use it to finish signup before following the steps.
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as jwt from 'jsonwebtoken';
import { Resend } from 'resend';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const curated: { name: string; email: string }[] = [
  { name: 'Boluwatife Daniels', email: 'danielsboluwatife@gmail.com' },
  { name: 'Sheriff Oyewo', email: 'oyewosheriff@gmail.com' },
  { name: 'Okechukwu Ugonna Buchi', email: 'buchiokechukwu@gmail.com' },
  { name: 'Chidozie James Chukwuemeka', email: 'terijamhomesandproperties@gmail.com' },
  { name: 'Omojoye Destiny', email: 'augustinedestiny15@gmail.com' },
  { name: 'Oluwatimilehin Okunlola', email: 'omodolapookunlola@gmail.com' },
  { name: 'Meghen Jonas', email: 'amieejonas@gmail.com' },
  { name: 'Adedolapo Olatinwo', email: 'adedollyolatino525@gmail.com' },
  { name: 'Obinna Onyeabor', email: 'michaelobinna522@gmail.com' },
  { name: 'Anita Ogedegbe', email: 'peteranita448@gmail.com' },
  { name: 'Adetayo Olorunjube', email: 'adetayoolorunjube@gmail.com' },
  { name: 'David Olaleru', email: 'davidolaleru@gmail.com' },
  { name: 'Josephine Michael', email: 'uwemJosephine8@gmail.com' },
  { name: 'Umar Jehohaniyi', email: 'officiallegitagent@gmail.com' },
  { name: 'Oho Rolland', email: 'ohorolland@gmail.com' },
  { name: 'Nuru Deen', email: 'info@dms.com.ng' },
  { name: 'Prince Uche Okocha', email: 'ucheprince572@gmail.com' },
  { name: 'Subhanallah Bello', email: 'subhanallahbello@gmail.com' },
  { name: 'Sunday Gbenga', email: 'olaniyansunday847@gmail.com' },
  { name: 'Green Psyche', email: 'greenpsyche1800@gmail.com' },
  { name: 'Saheed Olanrewaju', email: 'naturelimited@gmail.com' },
  { name: 'Olanrewaju Fadeyi', email: 'bigmanlanre@gmail.com' },
  { name: 'Ibrahim Agboola', email: 'appliedweber01@gmail.com' },
];

// ─── Args ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const broadcast = args.includes('--send');
const onlyPending = args.includes('--only-pending');
const testArg = args.find((a) => a.startsWith('--test='));
const testEmail = testArg ? testArg.split('=')[1] : null;
const roleArg = args.find((a) => a.startsWith('--role='));
const roleFilter = roleArg ? roleArg.split('=')[1].toLowerCase() : null;

if (roleFilter && !['agent', 'vendor', 'buyer'].includes(roleFilter)) {
  console.error(
    `--role must be one of: agent, vendor, buyer (got "${roleFilter}")`,
  );
  process.exit(1);
}
if (!broadcast && !testEmail && !dryRun) {
  console.error(
    'You must pass exactly one of:\n' +
      '  --test=you@example.com   (send one preview)\n' +
      '  --send                   (real broadcast)\n' +
      '  --dry-run                (preview without sending)\n' +
      '\n' +
      'Optional:\n' +
      '  --role=agent|vendor|buyer  (filter to a single role)\n' +
      '  --only-pending             (skip already-activated recipients)\n',
  );
  process.exit(1);
}

// ─── Env ────────────────────────────────────────────────────────────────
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not set');

const tokenSecret = process.env.WAITLIST_TOKEN_SECRET;
if (!tokenSecret) {
  console.error('✗ WAITLIST_TOKEN_SECRET is not set');
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

const typeToRole: Record<string, string> = {
  REAL_ESTATE_AGENT: 'agent',
  BUILDER: 'vendor',
  BUILDING_MATERIALS_SUPPLIER_INSTALLER: 'vendor',
  PARTNER_INVESTOR: 'buyer',
};

const resend = resendKey ? new Resend(resendKey) : null;
const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter } as any);

// ─── "Getting started" content per role ─────────────────────────────────
type Role = 'agent' | 'vendor' | 'buyer';

type StartStep = { title: string; body: string; href: string };

function startSteps(role: Role): StartStep[] {
  if (role === 'agent') {
    return [
      {
        title: '1. Add your first listing',
        body: 'Upload photos, video walkthroughs, features, and your Certificate of Occupancy. Verified listings get a green badge — buyers trust them more.',
        href: `${frontendUrl}/add-property`,
      },
      {
        title: '2. Complete your agent profile',
        body: 'Add your photo, agency name, license number, bio, and service area. Buyers see this on every listing and on your public profile.',
        href: `${frontendUrl}/dashboard?tab=settings`,
      },
      {
        title: '3. Track viewing requests',
        body: 'When a buyer requests a viewing on one of your listings, it appears under Viewings. Confirm the slot, message them, mark it complete.',
        href: `${frontendUrl}/dashboard?tab=viewings`,
      },
      {
        title: '4. Reply to buyer messages',
        body: 'Buyers can chat directly from any property page. Unread messages show on the bell icon — keep response time low to win more deals.',
        href: `${frontendUrl}/dashboard?tab=messages`,
      },
      {
        title: '5. Mark sold or rented',
        body: 'When a deal closes, mark the listing SOLD or RENTED. It moves into your Property Logbook and bumps your verified deal count.',
        href: `${frontendUrl}/dashboard?tab=listings`,
      },
    ];
  }
  if (role === 'vendor') {
    return [
      {
        title: '1. Complete your profile',
        body: 'Set your service category, area, banner image, bio, and years of experience. A complete profile gets booked faster.',
        href: `${frontendUrl}/dashboard?tab=settings`,
      },
      {
        title: '2. Watch for job requests',
        body: 'Buyers send you bookings — sometimes with photos or a quick video of the work needed. Accept, decline, or chat to negotiate scope.',
        href: `${frontendUrl}/dashboard?tab=jobs`,
      },
      {
        title: '3. Get paid via escrow',
        body: 'PropertyLoop holds the payment until the job is confirmed complete — protecting both you and the buyer. Just deliver good work.',
        href: `${frontendUrl}/dashboard?tab=jobs`,
      },
      {
        title: '4. Build your reviews',
        body: 'Reviews show on your public profile and the home page. Higher ratings unlock more visibility on the Service Loop.',
        href: `${frontendUrl}/dashboard?tab=reviews`,
      },
    ];
  }
  return [
    {
      title: '1. Browse properties',
      body: 'Filter by location, type, price and bedrooms. Save the ones you love to come back to later.',
      href: `${frontendUrl}/buy`,
    },
    {
      title: '2. Request a viewing',
      body: 'On any property page, schedule a viewing in a few taps. Track the status from your dashboard.',
      href: `${frontendUrl}/dashboard?tab=viewings`,
    },
    {
      title: '3. Find a vendor',
      body: 'Need a plumber, cleaner, painter or electrician? Browse vetted vendors and book one with photos or videos of the job.',
      href: `${frontendUrl}/dashboard?tab=vendors`,
    },
  ];
}

// ─── Email template (matches the waitlist confirmation aesthetic) ──────
function emailHtml(opts: {
  firstName: string;
  role: Role;
  inviteUrl: string;
  alreadyActivated: boolean;
}) {
  const { firstName, role, inviteUrl, alreadyActivated } = opts;
  const friendly = firstName ? `Hi ${firstName},` : 'Hi there,';

  const intro =
    role === 'agent'
      ? "Here's a look at what's coming to you as a registered agent on PropertyLoop — built to help you grow your real estate business in Nigeria."
      : role === 'vendor'
        ? "Here's how to get the most out of PropertyLoop as a service vendor — built to bring you more bookings, faster, with payment protected."
        : "Here's how to get the most out of PropertyLoop — built to help you find, book, and track every property and service you need.";

  const sectionLabel =
    role === 'agent'
      ? 'What to do first as an agent'
      : role === 'vendor'
        ? 'What to do first as a vendor'
        : 'What to do first';

  const fallbackBlock = alreadyActivated
    ? ''
    : `<div class="alert">
         <div class="alert-label">Haven't activated yet?</div>
         <div class="alert-body">Your details are already pre-filled — just set a password to finish.</div>
         <a href="${inviteUrl}" class="alert-link">Activate my account →</a>
       </div>`;

  const featureRows = startSteps(role)
    .map(
      (s) => `
      <div class="feature-row">
        <div class="feature-dot"></div>
        <div class="feature-content">
          <div class="feature-title">${s.title}</div>
          <div class="feature-desc">${s.body}</div>
          <a href="${s.href}" class="feature-link">Open →</a>
        </div>
      </div>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Getting started on PropertyLoop</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
        background-color: #0a1410;
        color: #c8d3cd;
        line-height: 1.6;
        -webkit-font-smoothing: antialiased;
      }
      .wrapper { background-color: #0a1410; padding: 40px 16px; }
      .container {
        max-width: 600px;
        margin: 0 auto;
        background-color: #0f1f14;
        border-radius: 8px;
        border: 1px solid rgba(74,222,128,0.15);
        overflow: hidden;
      }
      .header {
        background-color: #0f1f14;
        padding: 36px 48px;
        text-align: left;
      }
      .header img { height: 36px; width: auto; display: block; }
      .divider-green { height: 3px; background-color: #2f9e61; }
      .content { padding: 48px; background-color: #0f1f14; }
      .greeting {
        font-size: 22px;
        font-weight: 600;
        color: #ffffff;
        margin-bottom: 16px;
        letter-spacing: -0.3px;
      }
      .body-text {
        font-size: 15px;
        color: #a8b5ad;
        line-height: 1.75;
        margin-bottom: 32px;
      }
      .alert {
        background-color: rgba(255,184,77,0.08);
        border: 1px solid rgba(255,184,77,0.25);
        border-left: 4px solid #f5a623;
        border-radius: 6px;
        padding: 14px 18px;
        margin-bottom: 32px;
      }
      .alert-label {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 1px;
        text-transform: uppercase;
        color: #f5a623;
        margin-bottom: 6px;
      }
      .alert-body {
        font-size: 13.5px;
        color: #e0d5b8;
        line-height: 1.55;
        margin-bottom: 10px;
      }
      .alert-link {
        font-size: 13px;
        color: #4ade80;
        font-weight: 600;
        text-decoration: none;
      }
      .section-label {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 1px;
        text-transform: uppercase;
        color: #4ade80;
        margin-bottom: 16px;
      }
      .feature-list { margin-bottom: 32px; }
      .feature-row {
        display: flex;
        align-items: flex-start;
        padding: 14px 0;
        border-bottom: 1px solid rgba(255,255,255,0.06);
      }
      .feature-row:last-child { border-bottom: none; }
      .feature-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background-color: #4ade80;
        margin-top: 8px;
        margin-right: 14px;
        flex-shrink: 0;
      }
      .feature-content { flex: 1; }
      .feature-title {
        font-size: 14px;
        font-weight: 600;
        color: #ffffff;
        margin-bottom: 2px;
      }
      .feature-desc {
        font-size: 14px;
        color: #a8b5ad;
        line-height: 1.6;
        margin-bottom: 6px;
      }
      .feature-link {
        font-size: 12.5px;
        color: #4ade80;
        font-weight: 600;
        text-decoration: none;
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
      .divider {
        border: none;
        border-top: 1px solid rgba(255,255,255,0.08);
        margin: 36px 0;
      }
      .closing { font-size: 15px; color: #a8b5ad; line-height: 1.75; }
      .signature { margin-top: 28px; }
      .signature-name { font-size: 14px; font-weight: 600; color: #ffffff; }
      .signature-title { font-size: 13px; color: #6b7d72; margin-top: 2px; }
      .footer {
        background-color: #081008;
        border-top: 1px solid rgba(255,255,255,0.06);
        padding: 28px 48px;
        text-align: center;
      }
      .footer-logo { margin-bottom: 16px; }
      .footer-logo img { height: 24px; width: auto; opacity: 0.5; }
      .footer-links { font-size: 12px; color: #6b7d72; margin-bottom: 10px; }
      .footer-links a { color: #a8b5ad; text-decoration: none; margin: 0 10px; }
      .footer-copy { font-size: 11px; color: #4a5853; }
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
          <div class="greeting">${friendly}</div>

          <p class="body-text">${intro}</p>

          ${fallbackBlock}

          <div class="section-label">${sectionLabel}</div>
          <div class="feature-list">${featureRows}</div>

          <div class="cta-block">
            <a href="${frontendUrl}/dashboard" class="cta-btn">Open my dashboard</a>
          </div>

          <hr class="divider">

          <p class="closing">
            You joined the waitlist because you believe in a better way to do real estate. We built this for you — and we're just getting started.
          </p>

          <p class="closing" style="margin-top:16px;">
            Questions? Reply to this email or write to
            <a href="mailto:support.propertyloop@propertyloop.ng" style="color:#4ade80;text-decoration:none;font-weight:600;">support.propertyloop@propertyloop.ng</a>.
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
          <div class="footer-links">
            <a href="https://propertyloop.ng/privacy">Privacy Policy</a>
            <a href="https://propertyloop.ng/terms">Terms of Service</a>
            <a href="https://propertyloop.ng/contact">Contact</a>
          </div>
          <div class="footer-copy">&copy; ${new Date().getFullYear()} PropertyLoop. All rights reserved.</div>
        </div>
      </div>
    </div>
  </body>
</html>`;
}

function plainText(opts: {
  firstName: string;
  role: Role;
  inviteUrl: string;
  alreadyActivated: boolean;
}) {
  const lines: string[] = [];
  lines.push(`Hi ${opts.firstName || 'there'},`);
  lines.push('');
  lines.push(
    `Welcome again to PropertyLoop. Here are a few things to do first${opts.role === 'agent' ? ' as an agent' : opts.role === 'vendor' ? ' as a service vendor' : ''}:`,
  );
  lines.push('');

  if (!opts.alreadyActivated) {
    lines.push(
      `Haven't activated yet? Use your personal link: ${opts.inviteUrl}`,
    );
    lines.push('');
  }

  for (const s of startSteps(opts.role)) {
    lines.push(s.title);
    lines.push(s.body);
    lines.push(s.href);
    lines.push('');
  }

  lines.push('Questions? support.propertyloop@propertyloop.ng');
  lines.push('');
  lines.push('— PropertyLoop');
  return lines.join('\n');
}

// ─── Recipients ─────────────────────────────────────────────────────────
type Recipient = {
  email: string;
  firstName: string;
  fullName: string;
  role: Role;
  inviteUrl: string;
  wlId: string;
  activated: boolean;
};

async function buildRecipients(): Promise<Recipient[]> {
  const allEntries = await prisma.waitlistEntry.findMany();
  const byEmail = new Map(
    allEntries.map((e) => [e.email.trim().toLowerCase(), e]),
  );

  const recipients: Recipient[] = [];
  const issues: string[] = [];

  for (const c of curated) {
    const entry = byEmail.get(c.email.trim().toLowerCase());
    if (!entry) {
      issues.push(`✗ ${c.email} — not in waitlist DB, skipping`);
      continue;
    }
    const role = typeToRole[entry.type];
    if (!role || !['agent', 'vendor', 'buyer'].includes(role)) {
      issues.push(`✗ ${c.email} — unknown role for type ${entry.type}`);
      continue;
    }
    const fullName = `${entry.first_name} ${entry.last_name}`.trim();
    const token = jwt.sign(
      {
        wlId: entry.id,
        name: fullName,
        email: entry.email,
        phone: entry.phone,
        location: entry.location ?? '',
        role,
      },
      tokenSecret!,
      { expiresIn: '90d' },
    );
    recipients.push({
      email: entry.email,
      firstName: entry.first_name?.trim() || '',
      fullName,
      role: role as Role,
      inviteUrl: `${frontendUrl}/onboarding?wl=${token}`,
      wlId: entry.id,
      activated: !!entry.activated,
    });
  }

  if (issues.length) {
    console.log('\nResolution notes:');
    for (const i of issues) console.log('  ' + i);
    console.log('');
  }

  let filtered = recipients;
  if (roleFilter) {
    const before = filtered.length;
    filtered = filtered.filter((r) => r.role === roleFilter);
    console.log(
      `Role filter: --role=${roleFilter} → ${filtered.length}/${before} recipients kept`,
    );
  }
  if (onlyPending) {
    const before = filtered.length;
    filtered = filtered.filter((r) => !r.activated);
    console.log(
      `Pending-only filter: → ${filtered.length}/${before} recipients kept`,
    );
  }

  return filtered;
}

// ─── Send loop ──────────────────────────────────────────────────────────
async function sendOne(r: Recipient, deliverTo?: string) {
  const to = deliverTo || r.email;
  const html = emailHtml({
    firstName: r.firstName,
    role: r.role,
    inviteUrl: r.inviteUrl,
    alreadyActivated: r.activated,
  });
  const text = plainText({
    firstName: r.firstName,
    role: r.role,
    inviteUrl: r.inviteUrl,
    alreadyActivated: r.activated,
  });
  const subject = `Getting started on PropertyLoop`;

  if (dryRun) {
    console.log(
      `[dry-run] would send to ${to} (role=${r.role}, activated=${r.activated})`,
    );
    return { ok: true };
  }

  try {
    await resend!.emails.send({ from: mailFrom, to, subject, html, text });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const recipients = await buildRecipients();

  if (testEmail) {
    const sample = recipients[0];
    if (!sample) {
      console.error('No eligible recipients to build a test from.');
      return;
    }
    console.log(
      `Sending TEST follow-up to ${testEmail} using ${sample.fullName}'s context (activated=${sample.activated})...`,
    );
    const res = await sendOne(sample, testEmail);
    if (res.ok) console.log('✓ Test sent. Open the email and check the layout.');
    else console.error('✗ Test failed:', (res as any).error);
    return;
  }

  console.log(`Resolved ${recipients.length} recipients.`);
  if (recipients.length === 0) return;

  const outDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const logPath = path.join(
    outDir,
    `curated-followup-log-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`,
  );
  const logLines = ['timestamp,email,role,activated,wlId,result,error'];

  let okCount = 0;
  let failCount = 0;

  for (let i = 0; i < recipients.length; i++) {
    const r = recipients[i];
    process.stdout.write(
      `(${i + 1}/${recipients.length}) ${r.email} [${r.role}, activated=${r.activated}]… `,
    );
    const res = await sendOne(r);
    const ts = new Date().toISOString();
    if (res.ok) {
      okCount++;
      console.log(dryRun ? 'DRY' : 'sent ✓');
      logLines.push(
        `${ts},${r.email},${r.role},${r.activated},${r.wlId},ok,`,
      );
    } else {
      failCount++;
      const errMsg = (res as any).error || 'unknown';
      console.log(`failed ✗  ${errMsg}`);
      logLines.push(
        `${ts},${r.email},${r.role},${r.activated},${r.wlId},error,"${errMsg.replace(/"/g, '""')}"`,
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
