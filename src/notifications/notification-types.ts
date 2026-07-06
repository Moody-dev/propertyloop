/**
 * Notification type keys. Kept as plain string constants (not a Prisma enum) so
 * new kinds can ship without a migration. The mobile app maps these to icons
 * and deep-link targets. `data` payloads are documented alongside each.
 */
export const NotificationType = {
  // Offers / purchase (buyer ⇄ agent)
  OFFER_RECEIVED: 'OFFER_RECEIVED', // → agent. data: { offerId }
  OFFER_COUNTERED: 'OFFER_COUNTERED', // → other party. data: { offerId }
  OFFER_ACCEPTED: 'OFFER_ACCEPTED', // → other party. data: { offerId, purchaseId }
  OFFER_DECLINED: 'OFFER_DECLINED', // → other party. data: { offerId }
  OFFER_WITHDRAWN: 'OFFER_WITHDRAWN', // → agent. data: { offerId }
  PURCHASE_STEP_UPDATED: 'PURCHASE_STEP_UPDATED', // → buyer. data: { purchaseId }

  // Vendor jobs (wired when those flows emit)
  JOB_REQUEST: 'JOB_REQUEST',
  JOB_ACCEPTED: 'JOB_ACCEPTED',
  JOB_DECLINED: 'JOB_DECLINED',
  JOB_ESCROW_FUNDED: 'JOB_ESCROW_FUNDED', // → vendor. data: { jobId } — customer paid, escrow locked
  JOB_STARTED: 'JOB_STARTED',
  JOB_COMPLETED: 'JOB_COMPLETED',
  JOB_CONFIRMED: 'JOB_CONFIRMED',
  JOB_DISPUTED: 'JOB_DISPUTED',

  // Viewings
  VIEWING_REQUESTED: 'VIEWING_REQUESTED',
  VIEWING_CONFIRMED: 'VIEWING_CONFIRMED',
  VIEWING_CANCELLED: 'VIEWING_CANCELLED',

  // Identity / KYC
  KYC_APPROVED: 'KYC_APPROVED',
  KYC_REJECTED: 'KYC_REJECTED',

  // Misc
  MESSAGE: 'MESSAGE',
  GENERAL: 'GENERAL',
} as const;

export type NotificationTypeKey =
  (typeof NotificationType)[keyof typeof NotificationType];
