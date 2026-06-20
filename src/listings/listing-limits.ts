import { SubscriptionTier } from '../../generated/prisma/client';

/**
 * Max active listings per tier. FOUNDING + PRO are unlimited (no entry here).
 * Shared by listing creation (the cap) and the subscription downgrade logic
 * (how many to keep active when an agent drops to FREE).
 */
export const LISTING_CAPS: Partial<Record<SubscriptionTier, number>> = {
  [SubscriptionTier.FREE]: 3,
  [SubscriptionTier.STANDARD]: 10,
};

/** Active listings a downgraded (cancel/lapse → FREE) agent keeps. */
export const FREE_LISTING_CAP = LISTING_CAPS[SubscriptionTier.FREE]!;
