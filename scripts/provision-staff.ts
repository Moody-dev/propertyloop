/**
 * Provision login details for the whole team in one go.
 *
 * Usage:
 *   npx ts-node scripts/provision-staff.ts --template roster.json
 *   # fill in the names and emails, then:
 *   npx ts-node scripts/provision-staff.ts roster.json
 *
 * Pass the filename to --template rather than redirecting with `>`:
 * PowerShell redirection writes UTF-16 with a BOM. The reader copes with it
 * either way, but writing it directly avoids the surprise.
 *
 *   npx ts-node scripts/provision-staff.ts --list
 *
 * Creates the User account and the StaffProfile together, generates a unique
 * temporary password for each person, and prints the credentials ONCE.
 *
 * Passwords are never written to disk and never stored in readable form — the
 * database keeps only a bcrypt hash, so this output is the only copy. Re-run
 * on somebody who already exists and the script rotates their password rather
 * than pretending it can show you the old one.
 *
 * Everyone should change their password on first sign-in via
 * POST /auth/change-password. A temporary password that travels through
 * WhatsApp has effectively been published.
 */
import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  Chapter,
  PrismaClient,
  Role,
  StaffPermission,
  StaffRole,
} from '../generated/prisma/client';
import { DEFAULT_STAFF_PERMISSIONS } from '../src/staff/staff-permissions';

interface RosterEntry {
  name: string;
  email: string;
  letter: string;
  staffRole: keyof typeof StaffRole;
  chapter?: keyof typeof Chapter;
  alsoOsun?: boolean;
  reportsTo?: string;
  /** Account role on the main site. Defaults by position — see accountRole(). */
  userRole?: keyof typeof Role;
  grant?: (keyof typeof StaffPermission)[];
  revoke?: (keyof typeof StaffPermission)[];
}

/** The September 2026 structure, with the names the org document assigns. */
const TEMPLATE: RosterEntry[] = [
  { name: '', email: '', letter: 'A', staffRole: 'MD_CEO' },
  { name: '', email: '', letter: 'B', staffRole: 'GM', reportsTo: '' },
  {
    name: 'Ola',
    email: '',
    letter: 'C',
    staffRole: 'PROPERTY_LISTING',
    reportsTo: '',
  },
  {
    name: 'Sodiq (1st)',
    email: '',
    letter: 'C',
    staffRole: 'PROPERTY_LISTING',
    alsoOsun: true,
    reportsTo: '',
  },
  { name: '', email: '', letter: 'D', staffRole: 'MARKETING', reportsTo: '' },
  {
    name: 'Ngozi',
    email: '',
    letter: 'E',
    staffRole: 'OPERATIONS',
    reportsTo: '',
  },
  { name: '', email: '', letter: 'F', staffRole: 'AMBASSADOR', reportsTo: '' },
  { name: '', email: '', letter: 'G', staffRole: 'SECRETARY', reportsTo: '' },
  {
    name: 'Sodiq (2nd)',
    email: '',
    letter: 'C',
    staffRole: 'PROPERTY_LISTING',
    chapter: 'OSUN',
    reportsTo: '',
  },
];

/**
 * Which account role a position gets on the main site.
 *
 * Deliberately stingy. Role.ADMIN is the coarse, everything-or-nothing flag
 * that StaffProfile exists to replace, so only the two positions that
 * genuinely need the admin panel get it. Everyone else is a BUYER on the
 * public site — harmless — and reaches the team portal through their
 * StaffProfile instead.
 */
function accountRole(staffRole: StaffRole): Role {
  return staffRole === StaffRole.MD_CEO || staffRole === StaffRole.GM
    ? Role.ADMIN
    : Role.BUYER;
}

/**
 * A password that survives being read aloud down a bad phone line.
 *
 * No 0/O, 1/l/I. Grouped into blocks because an unbroken 16-character string
 * gets mistyped, and a mistyped temporary password looks exactly like a
 * server problem to the person trying to sign in.
 */
function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const block = (n: number) =>
    Array.from(
      { length: n },
      () => alphabet[crypto.randomInt(alphabet.length)],
    ).join('');
  // A symbol keeps it clear of any "letters and numbers only" complaint.
  return `${block(5)}-${block(5)}-${block(4)}#`;
}

/**
 * Read a text file whatever encoding the shell wrote it in.
 *
 * PowerShell's `>` produces UTF-16LE with a byte-order mark, which is not
 * valid JSON and fails with an unreadable "Unexpected token" on the BOM. That
 * is the default on Windows, so the roster arrives this way more often than
 * not — the script decodes it rather than making somebody work out why their
 * own file looks like mojibake.
 */
function readTextFile(path: string): string {
  const buf = fs.readFileSync(path);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.subarray(2).toString('utf16le');
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    // UTF-16BE: swap each pair, since Node only decodes LE.
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  if (
    buf.length >= 3 &&
    buf[0] === 0xef &&
    buf[1] === 0xbb &&
    buf[2] === 0xbf
  ) {
    return buf.subarray(3).toString('utf8');
  }
  return buf.toString('utf8');
}

function parseEnum<T extends object>(
  value: string | undefined,
  target: T,
  label: string,
): keyof T | undefined {
  if (!value) return undefined;
  const upper = value.toUpperCase();
  if (!(upper in target)) {
    throw new Error(
      `Unknown ${label} "${value}". Valid: ${Object.keys(target).join(', ')}`,
    );
  }
  return upper as keyof T;
}

async function main() {
  const templateFlag = process.argv.indexOf('--template');
  if (templateFlag !== -1) {
    const json = JSON.stringify(TEMPLATE, null, 2);
    const target = process.argv[templateFlag + 1];
    if (target && !target.startsWith('--')) {
      // Written here rather than piped, so the shell cannot choose the
      // encoding for us.
      fs.writeFileSync(target, json, { encoding: 'utf8' });
      console.log(`Wrote ${TEMPLATE.length} positions to ${target}`);
      console.log('Fill in the names and emails, then run:');
      console.log(`  npx ts-node scripts/provision-staff.ts ${target}`);
    } else {
      console.log(json);
    }
    return;
  }

  const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter } as any);

  try {
    if (process.argv.includes('--list')) {
      const all = await prisma.staffProfile.findMany({
        include: { user: { select: { name: true, email: true, role: true } } },
        orderBy: [{ chapter: 'asc' }, { letter: 'asc' }],
      });
      if (!all.length) {
        console.log('No staff profiles yet.');
        return;
      }
      console.log(`${all.length} staff profile(s):\n`);
      for (const s of all) {
        console.log(
          `  [${s.letter}] ${s.user.name} <${s.user.email}>\n` +
            `      ${s.staffRole} · ${s.chapter}` +
            `${s.secondaryChapter ? ` (also ${s.secondaryChapter})` : ''}` +
            `${s.active ? '' : ' · INACTIVE'}\n` +
            `      account role: ${s.user.role} · ${s.permissions.length} permissions\n`,
        );
      }
      return;
    }

    const file = process.argv[2];
    if (!file) {
      console.error(
        'Usage:\n' +
          '  npx ts-node scripts/provision-staff.ts --template > roster.json\n' +
          '  npx ts-node scripts/provision-staff.ts roster.json\n' +
          '  npx ts-node scripts/provision-staff.ts --list',
      );
      process.exit(1);
    }
    if (!fs.existsSync(file)) throw new Error(`No such file: ${file}`);

    const roster = JSON.parse(readTextFile(file)) as RosterEntry[];
    if (!Array.isArray(roster)) throw new Error('Roster must be a JSON array');

    // Validate the whole roster before writing anything. A half-provisioned
    // team is worse than none — you cannot tell who got credentials.
    const seen = new Set<string>();
    roster.forEach((r, i) => {
      const at = `entry ${i + 1}`;
      if (!r.name?.trim()) throw new Error(`${at}: name is required`);
      if (!r.email?.trim())
        throw new Error(`${at} (${r.name}): email is required`);
      const email = r.email.trim().toLowerCase();
      if (seen.has(email)) {
        throw new Error(
          `${at}: ${email} appears twice — logins must be unique`,
        );
      }
      seen.add(email);
      if (!r.letter?.trim())
        throw new Error(`${at} (${r.name}): letter is required`);
      parseEnum(r.staffRole, StaffRole, 'staffRole');
      parseEnum(r.chapter, Chapter, 'chapter');
      parseEnum(r.userRole, Role, 'userRole');
      (r.grant ?? []).forEach((p) =>
        parseEnum(p, StaffPermission, 'permission'),
      );
      (r.revoke ?? []).forEach((p) =>
        parseEnum(p, StaffPermission, 'permission'),
      );
    });

    const results: {
      name: string;
      email: string;
      password: string;
      letter: string;
      staffRole: string;
      accountRole: string;
      permissions: number;
      created: boolean;
    }[] = [];

    // Two passes: everyone exists before anyone reports to anyone, so
    // reportsTo can name somebody further down the roster.
    for (const entry of roster) {
      const email = entry.email.trim().toLowerCase();
      const staffRole = entry.staffRole.toUpperCase() as StaffRole;
      const chapter = (entry.chapter?.toUpperCase() ?? 'LAGOS') as Chapter;
      const role = entry.userRole
        ? (entry.userRole.toUpperCase() as Role)
        : accountRole(staffRole);

      const password = generatePassword();
      const passwordHash = await bcrypt.hash(password, 12);

      const existing = await prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });

      const user = existing
        ? await prisma.user.update({
            where: { email },
            // Rotating the password is the only way to hand somebody working
            // credentials — the stored hash cannot be read back.
            data: {
              passwordHash,
              name: entry.name.trim(),
              role,
              isActive: true,
              deactivatedAt: null,
              emailVerifiedAt: new Date(),
            },
            select: { id: true },
          })
        : await prisma.user.create({
            data: {
              email,
              passwordHash,
              name: entry.name.trim(),
              role,
              // Staff are onboarded in person, so there is nothing for an
              // email verification round-trip to prove.
              emailVerifiedAt: new Date(),
              signupPlatform: 'web',
            },
            select: { id: true },
          });

      const granted = new Set<StaffPermission>(
        DEFAULT_STAFF_PERMISSIONS[staffRole],
      );
      for (const p of entry.grant ?? []) {
        granted.add(p.toUpperCase() as StaffPermission);
      }
      for (const p of entry.revoke ?? []) {
        granted.delete(p.toUpperCase() as StaffPermission);
      }
      const permissions = [...granted];

      await prisma.staffProfile.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          letter: entry.letter.trim().toUpperCase(),
          staffRole,
          chapter,
          secondaryChapter:
            entry.alsoOsun && chapter !== Chapter.OSUN ? Chapter.OSUN : null,
          permissions,
        },
        update: {
          letter: entry.letter.trim().toUpperCase(),
          staffRole,
          chapter,
          secondaryChapter:
            entry.alsoOsun && chapter !== Chapter.OSUN ? Chapter.OSUN : null,
          permissions,
          active: true,
        },
      });

      results.push({
        name: entry.name.trim(),
        email,
        password,
        letter: entry.letter.trim().toUpperCase(),
        staffRole,
        accountRole: role,
        permissions: permissions.length,
        created: !existing,
      });
    }

    // Second pass: reporting lines, once every profile exists.
    for (const entry of roster) {
      if (!entry.reportsTo?.trim()) continue;
      const managerEmail = entry.reportsTo.trim().toLowerCase();
      const manager = await prisma.staffProfile.findFirst({
        where: { user: { email: managerEmail } },
        select: { id: true },
      });
      if (!manager) {
        console.warn(
          `  ! ${entry.name}: no staff profile for manager ${managerEmail} — reporting line left unset`,
        );
        continue;
      }
      await prisma.staffProfile.updateMany({
        where: { user: { email: entry.email.trim().toLowerCase() } },
        data: { reportsToId: manager.id },
      });
    }

    // ─── Credentials ─────────────────────────────────────────────────────
    console.log('\n' + '='.repeat(74));
    console.log(
      '  TEAM PORTAL LOGIN DETAILS — shown once, not stored anywhere',
    );
    console.log('='.repeat(74) + '\n');

    for (const r of results) {
      console.log(
        `  [${r.letter}] ${r.name}  ${r.created ? '(new)' : '(password rotated)'}`,
      );
      console.log(`      Email    : ${r.email}`);
      console.log(`      Password : ${r.password}`);
      console.log(
        `      Position : ${r.staffRole} · account role ${r.accountRole} · ${r.permissions} permissions`,
      );
      console.log('');
    }

    console.log('='.repeat(74));
    console.log(
      '  These passwords are temporary and are not recoverable — the database\n' +
        '  keeps only a hash. Send each person THEIR OWN line, privately, and\n' +
        '  have them change it on first sign-in. A password sent to a group\n' +
        '  chat has been published.\n',
    );
    const admins = results.filter((r) => r.accountRole === 'ADMIN');
    if (admins.length) {
      console.log(
        `  ${admins.length} account(s) have the ADMIN role on the main site ` +
          `(${admins.map((a) => a.name).join(', ')}).\n` +
          '  That is the coarse everything-or-nothing flag, granted only where\n' +
          '  the admin panel is genuinely needed.\n',
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
