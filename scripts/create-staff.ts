/**
 * Create or update a PropertyLoop staff profile.
 *
 * Usage:
 *   npx ts-node scripts/create-staff.ts <email> <ROLE> <LETTER> [options]
 *
 *   ROLE     MD_CEO | GM | PROPERTY_LISTING | MARKETING | OPERATIONS
 *            | AMBASSADOR | SECRETARY
 *   LETTER   the position letter from the org document, e.g. C
 *
 * Options:
 *   --chapter=LAGOS|OSUN        default LAGOS
 *   --also-osun                 secondary Osun duties (Sodiq 1st)
 *   --reports-to=<email>        their manager, by email
 *   --grant=PERM,PERM           add permissions beyond the position default
 *   --revoke=PERM,PERM          remove permissions the position would grant
 *   --list                      print every staff profile and exit
 *
 * Examples:
 *   npx ts-node scripts/create-staff.ts ola@propertyloop.ng PROPERTY_LISTING C
 *   npx ts-node scripts/create-staff.ts sodiq1@propertyloop.ng PROPERTY_LISTING C --also-osun
 *   npx ts-node scripts/create-staff.ts ngozi@propertyloop.ng OPERATIONS E --reports-to=gm@propertyloop.ng
 *
 * The user account must already exist — this script never creates one, because
 * a staff profile attached to an account nobody controls is worse than none.
 * Use scripts/create-admin.ts first if the person has no account yet.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  Chapter,
  PrismaClient,
  StaffPermission,
  StaffRole,
} from '../generated/prisma/client';
import { DEFAULT_STAFF_PERMISSIONS } from '../src/staff/staff-permissions';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split('=').slice(1).join('=');
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parsePermissions(raw: string | undefined): StaffPermission[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((p) => p.trim().toUpperCase())
    .filter(Boolean)
    .map((p) => {
      if (!(p in StaffPermission)) {
        throw new Error(
          `Unknown permission "${p}". Valid: ${Object.keys(StaffPermission).join(', ')}`,
        );
      }
      return p as StaffPermission;
    });
}

async function main() {
  const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter } as any);

  try {
    if (flag('list')) {
      const all = await prisma.staffProfile.findMany({
        include: { user: { select: { name: true, email: true } } },
        orderBy: [{ chapter: 'asc' }, { letter: 'asc' }],
      });
      if (all.length === 0) {
        console.log('No staff profiles yet.');
        return;
      }
      console.log(`${all.length} staff profile(s):\n`);
      for (const s of all) {
        const flags = [
          s.active ? '' : 'INACTIVE',
          s.secondaryChapter ? `also ${s.secondaryChapter}` : '',
        ]
          .filter(Boolean)
          .join(', ');
        console.log(
          `  [${s.letter}] ${s.user.name} <${s.user.email}>\n` +
            `      ${s.staffRole} · ${s.chapter}${flags ? ` · ${flags}` : ''}\n` +
            `      ${s.permissions.length} permissions: ${s.permissions.join(', ')}\n`,
        );
      }
      return;
    }

    const [, , emailArg, roleArg, letterArg] = process.argv;
    if (!emailArg || !roleArg || !letterArg) {
      console.error(
        'Usage: npx ts-node scripts/create-staff.ts <email> <ROLE> <LETTER> [options]\n' +
          '       npx ts-node scripts/create-staff.ts --list\n\n' +
          `ROLE: ${Object.keys(StaffRole).join(' | ')}`,
      );
      process.exit(1);
    }

    const email = emailArg.trim().toLowerCase();
    const role = roleArg.trim().toUpperCase();
    if (!(role in StaffRole)) {
      throw new Error(
        `Unknown role "${role}". Valid: ${Object.keys(StaffRole).join(', ')}`,
      );
    }
    const staffRole = role as StaffRole;
    const letter = letterArg.trim().toUpperCase();

    const chapterRaw = (arg('chapter') ?? 'LAGOS').toUpperCase();
    if (!(chapterRaw in Chapter)) {
      throw new Error(`Unknown chapter "${chapterRaw}". Valid: LAGOS, OSUN`);
    }
    const chapter = chapterRaw as Chapter;
    const secondaryChapter =
      flag('also-osun') && chapter !== Chapter.OSUN ? Chapter.OSUN : null;

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, email: true, deletedAt: true },
    });
    if (!user || user.deletedAt) {
      throw new Error(
        `No user with email ${email}. Create the account first — this script ` +
          `will not invent one.`,
      );
    }

    let reportsToId: string | null = null;
    const managerEmail = arg('reports-to');
    if (managerEmail) {
      const manager = await prisma.staffProfile.findFirst({
        where: { user: { email: managerEmail.trim().toLowerCase() } },
        select: { id: true },
      });
      if (!manager) {
        throw new Error(
          `No staff profile for manager ${managerEmail}. Add them first.`,
        );
      }
      reportsToId = manager.id;
    }

    // Start from the position's defaults, then apply explicit adjustments.
    // Stored explicitly so changing a default later never silently re-grants.
    const granted = new Set<StaffPermission>(DEFAULT_STAFF_PERMISSIONS[staffRole]);
    for (const p of parsePermissions(arg('grant'))) granted.add(p);
    for (const p of parsePermissions(arg('revoke'))) granted.delete(p);
    const permissions = [...granted];

    const existing = await prisma.staffProfile.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });

    const profile = existing
      ? await prisma.staffProfile.update({
          where: { userId: user.id },
          data: {
            letter,
            staffRole,
            chapter,
            secondaryChapter,
            permissions,
            ...(reportsToId && { reportsToId }),
            active: true,
          },
        })
      : await prisma.staffProfile.create({
          data: {
            userId: user.id,
            letter,
            staffRole,
            chapter,
            secondaryChapter,
            permissions,
            reportsToId,
          },
        });

    console.log(
      `${existing ? '✓ Updated' : '✓ Created'} staff profile for ${user.name} <${user.email}>`,
    );
    console.log(`  Position : [${letter}] ${staffRole}`);
    console.log(
      `  Chapter  : ${chapter}${secondaryChapter ? ` (also ${secondaryChapter})` : ''}`,
    );
    console.log(`  Reports  : ${reportsToId ? managerEmail : 'nobody'}`);
    console.log(`  Grants   : ${permissions.length}`);
    for (const p of permissions) console.log(`      · ${p}`);

    const sensitive = permissions.filter((p) =>
      (
        [
          StaffPermission.APPROVE_WITHDRAWAL,
          StaffPermission.REVIEW_KYC,
          StaffPermission.RESOLVE_DISPUTE,
          StaffPermission.MANAGE_STAFF,
        ] as StaffPermission[]
      ).includes(p),
    );
    if (sensitive.length > 0) {
      console.log(
        `\n  ⚠ This person can now: ${sensitive.join(', ')}.\n` +
          `    Those move money or expose identity documents.`,
      );
    }
    console.log(`\n  Profile id: ${profile.id}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(`✗ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
