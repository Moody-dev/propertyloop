import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

// Unambiguous alphabet (no 0/O, 1/I/L) — codes get read aloud and hand-typed
// from WhatsApp shares, so avoid characters that are easy to confuse.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

export function generateReferralCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  }
  return code;
}

/**
 * Mint a referral code that isn't already taken. With a 31^8 keyspace a
 * collision is vanishingly rare; five in a row means something is broken,
 * so give up rather than loop forever.
 */
export async function allocateUniqueReferralCode(
  prisma: PrismaService,
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateReferralCode();
    const clash = await prisma.user.findUnique({
      where: { referralCode: code },
      select: { id: true },
    });
    if (!clash) return code;
  }
  throw new Error('Could not allocate a unique referral code');
}

/** The personalized share link a user sends out. */
export function buildReferralLink(frontendUrl: string, code: string): string {
  return `${frontendUrl.replace(/\/$/, '')}/onboarding?ref=${code}`;
}
