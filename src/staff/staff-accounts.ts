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
 * A temporary password that survives being read aloud down a bad line.
 * No 0/O or 1/l/I, and grouped, because a mistyped temporary password looks
 * exactly like a server problem to the person trying to sign in.
 */
export function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const block = (n: number) =>
    Array.from(
      { length: n },
      () => alphabet[crypto.randomInt(alphabet.length)],
    ).join('');
  return `${block(5)}-${block(5)}-${block(4)}#`;
}
