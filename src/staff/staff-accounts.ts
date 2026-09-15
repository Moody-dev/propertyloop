import * as crypto from 'crypto';
import { Role, StaffRole } from '../../generated/prisma/client';

/*
 * The portal's "Add position" form and scripts/provision-staff.ts must create
 * the same kind of account, so these follow the script exactly.
 */

/**
 * The product-level role a staff account carries. Only the MD and GM get
 * ADMIN — the coarse everything-or-nothing flag the admin console checks.
 * Everyone else's reach is governed by StaffProfile.permissions instead.
 */
export function accountRole(staffRole: StaffRole): Role {
  return staffRole === StaffRole.MD_CEO || staffRole === StaffRole.GM
    ? Role.ADMIN
    : Role.BUYER;
}

/**
 * A temporary password that survives being printed, read aloud, and typed on
 * a phone.
 *
 * Small letters and digits only. Mixed case was the problem: C/c, S/s, V/v,
 * X/x and friends are near-identical on paper, so a password printed as
 * "xVcs2" gets typed with one letter in the wrong case and is rejected with
 * nothing on screen to explain why. No i/l/o/0/1 either, and no symbol that
 * needs the second keyboard page. Grouped with hyphens for reading; 31
 * characters over 14 places is still ~69 bits.
 */
export function generatePassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const block = (n: number) =>
    Array.from(
      { length: n },
      () => alphabet[crypto.randomInt(alphabet.length)],
    ).join('');
  return `${block(5)}-${block(5)}-${block(4)}`;
}
