/**
 * Tell the partners who registered before there was a way back in.
 *
 * Their accounts were created without a usable password, and the welcome
 * email never carried a set-password link — so they could not reach their
 * dashboard to add a bank account or copy their referral link. New partners
 * now choose a password on the form; these people need one email explaining
 * how to set theirs.
 *
 * Usage:
 *   npx ts-node scripts/email-existing-partners-login.ts --dry
 *   npx ts-node scripts/email-existing-partners-login.ts --sample
 *   npx ts-node scripts/email-existing-partners-login.ts --send
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Resend } from 'resend';
import { PrismaClient } from '../generated/prisma/client';
import { SITE_URL, firstName, shell } from '../src/stock-alerts/stock-email';

const GAP_MS = 600;
const DEFAULT_SAMPLE_TO = 'olaoluwaoyetibo@gmail.com';

function build(
  name: string | null,
  email: string,
  code: string,
  referralUrl: string,
) {
  const who = firstName(name);
  const subject =
    'Your PropertyLoop partner dashboard is ready — set your password';
  const html = shell(
    subject,
    `
      <div class="greeting">Hi ${who},</div>
      <p class="body-text">
        You registered as PropertyLoop partner <strong>${code}</strong>, but until
        now there was no way to sign in and manage it. That is fixed. Your
        dashboard is where you edit your details, add your bank account so your
        commission can be paid, and copy your referral link whenever you need it.
      </p>
      <div class="section-label">Getting in, once</div>
      <ol class="steps">
        <li>
          Go to
          <a href="${SITE_URL}/forgot-password">propertyloop.ng/forgot-password</a>
          and enter <strong>${email}</strong>.
        </li>
        <li>We email you a 6-digit code. Use it to set a password you choose.</li>
        <li>
          Sign in at <a href="${SITE_URL}/login">propertyloop.ng/login</a>, then
          open <strong>Partnership</strong> in your dashboard.
        </li>
      </ol>
      <p>
        <a class="btn" href="${SITE_URL}/forgot-password">Set my password</a>
        <a class="btn-secondary" href="${SITE_URL}/agent-dashboard/partnership">My partnership</a>
      </p>
      <div class="section-label" style="margin-top:28px;">Your referral link</div>
      <p class="body-text" style="margin-bottom:8px;">
        Anyone who registers through this link is credited to you:
      </p>
      <p style="margin:0 0 24px;">
        <a href="${referralUrl}" style="font-size:13px;color:#2f9e61;word-break:break-all;">${referralUrl}</a>
      </p>
      <p class="note">
        Trouble getting in? Reply to this email, or message us on WhatsApp at
        <a href="https://wa.me/2347053053040">0705 305 3040</a>.
      </p>
    `,
  );
  const text = [
    `Hi ${who},`,
    '',
    `You registered as PropertyLoop partner ${code}, but until now there was no way to sign in and manage it. That is fixed.`,
    '',
    'Getting in, once:',
    `1. Go to ${SITE_URL}/forgot-password and enter ${email}.`,
    '2. We email you a 6-digit code. Use it to set a password you choose.',
    `3. Sign in at ${SITE_URL}/login, then open Partnership in your dashboard.`,
    '',
    'There you can edit your details, add your bank account so your commission can be paid, and copy your referral link.',
    '',
    `Your referral link: ${referralUrl}`,
    '',
    'Trouble getting in? Reply to this email, or message us on WhatsApp at 0705 305 3040.',
  ].join('\n');
  return { subject, html, text };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args = process.argv.slice(2);
  const send = args.includes('--send');
  const sampleFlag = args.indexOf('--sample');
  const sampleTo =
    sampleFlag !== -1 ? (args[sampleFlag + 1] ?? DEFAULT_SAMPLE_TO) : undefined;

  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.MAIL_FROM;
  if (!process.env.RESEND_API_KEY || !from) {
    throw new Error('RESEND_API_KEY and MAIL_FROM must be set');
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: (process.env.DIRECT_URL || process.env.DATABASE_URL)!,
    }),
  } as any);

  try {
    const partners = await prisma.agentPartner.findMany({
      orderBy: { registeredAt: 'asc' },
      select: {
        code: true,
        user: {
          select: { name: true, email: true, isActive: true, deletedAt: true },
        },
      },
    });
    const live = partners.filter((p) => p.user.isActive && !p.user.deletedAt);
    console.log(`${live.length} partner(s) of ${partners.length}:`);
    for (const p of live) console.log(`  ${p.code}  ${p.user.email}`);

    const referral = (code: string) =>
      `${SITE_URL}/realtors/partners?ref=${code}`;

    if (sampleTo) {
      const one = live[0];
      const { subject, html, text } = build(
        'Sample',
        one?.user.email ?? 'partner@example.com',
        one?.code ?? 'AGT-0000',
        referral(one?.code ?? 'AGT-0000'),
      );
      await resend.emails.send({
        from,
        to: sampleTo,
        subject: `[SAMPLE] ${subject}`,
        html,
        text,
      });
      console.log(`\nSample → ${sampleTo}`);
      return;
    }

    if (!send) {
      console.log('\nDry run. Re-run with --send to email these partners.');
      return;
    }

    let sent = 0;
    let failed = 0;
    for (const [i, p] of live.entries()) {
      const { subject, html, text } = build(
        p.user.name,
        p.user.email,
        p.code,
        referral(p.code),
      );
      try {
        await resend.emails.send({
          from,
          to: p.user.email,
          subject,
          html,
          text,
        });
        sent += 1;
        console.log(`✓ ${i + 1}/${live.length} ${p.code} ${p.user.email}`);
      } catch (err) {
        failed += 1;
        console.error(`✗ ${p.user.email}:`, (err as Error).message);
      }
      if (i < live.length - 1) await sleep(GAP_MS);
    }
    console.log(`\nDone. Sent ${sent}, failed ${failed}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
