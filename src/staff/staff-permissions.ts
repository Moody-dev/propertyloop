import { StaffPermission, StaffRole } from '../../generated/prisma/client';

/**
 * Default grants per position.
 *
 * Applied when a StaffProfile is created; the stored `permissions` array is
 * the authority afterwards, so an individual can be given more or less than
 * their position's default without changing anyone else.
 *
 * The shape of this map is the whole argument for the StaffProfile table.
 * Before it, giving the team logins meant making everyone Role.ADMIN, and
 * every admin endpoint runs the same check — so the Secretary and the Video
 * Presenter would have held the CEO's powers: suspend any user, change any
 * listing's status, approve withdrawals, resolve escrow disputes, read KYC
 * identity documents.
 */
export const DEFAULT_STAFF_PERMISSIONS: Record<StaffRole, StaffPermission[]> = {
  // Everything. One person, deliberately.
  [StaffRole.MD_CEO]: Object.values(StaffPermission),

  // Runs the team and the revenue line. Not KYC, and not payouts — the person
  // carrying the sales number should not also be the one who releases the
  // money.
  [StaffRole.GM]: [
    StaffPermission.VIEW_REVENUE,
    StaffPermission.VIEW_ALL_TARGETS,
    StaffPermission.MANAGE_TARGETS,
    StaffPermission.MANAGE_DEALS,
    StaffPermission.MANAGE_PROPERTIES,
    StaffPermission.PUBLISH_PROPERTY,
    StaffPermission.VERIFY_DOCUMENTS,
    StaffPermission.MANAGE_LEADS,
    StaffPermission.QUALIFY_LEAD,
    StaffPermission.MANAGE_CONTENT,
    StaffPermission.HANDLE_OPS,
    StaffPermission.RESOLVE_DISPUTE,
    StaffPermission.VIEW_ALL_LOGS,
    StaffPermission.MANAGE_PARTNERS,
  ],

  // Ola and Sodiq (1st). Inventory quality is theirs end to end.
  [StaffRole.PROPERTY_LISTING]: [
    StaffPermission.MANAGE_DEALS,
    StaffPermission.MANAGE_PROPERTIES,
    StaffPermission.PUBLISH_PROPERTY,
    StaffPermission.VERIFY_DOCUMENTS,
    StaffPermission.MANAGE_LEADS,
    StaffPermission.HANDLE_OPS,
  ],

  // Generates leads and owns the content calendar. Can qualify a lead, which
  // is the point of sharing one definition with the GM.
  [StaffRole.MARKETING]: [
    StaffPermission.MANAGE_LEADS,
    StaffPermission.QUALIFY_LEAD,
    StaffPermission.MANAGE_CONTENT,
  ],

  // Ngozi. The operations queue is the job, so this is the widest ops access
  // outside management — including KYC, which the org document leaves unowned.
  [StaffRole.OPERATIONS]: [
    StaffPermission.MANAGE_LEADS,
    StaffPermission.QUALIFY_LEAD,
    StaffPermission.HANDLE_OPS,
    StaffPermission.REVIEW_KYC,
    StaffPermission.MANAGE_PROPERTIES,
    // Onboarding a new realtor within 48 hours is Ngozi's stated target, so
    // the directory has to be hers to work.
    StaffPermission.MANAGE_PARTNERS,
  ],

  // On camera. Needs to see what is being shot and nothing else.
  [StaffRole.AMBASSADOR]: [StaffPermission.MANAGE_CONTENT],

  // Preps shoots. Same content scope as the Ambassador, plus the ops queue
  // for correspondence and follow-ups.
  [StaffRole.SECRETARY]: [
    StaffPermission.MANAGE_CONTENT,
    StaffPermission.HANDLE_OPS,
  ],
};

/** Permissions that move money or expose identity documents. */
export const SENSITIVE_PERMISSIONS: StaffPermission[] = [
  StaffPermission.APPROVE_WITHDRAWAL,
  StaffPermission.REVIEW_KYC,
  StaffPermission.RESOLVE_DISPUTE,
  StaffPermission.MANAGE_STAFF,
];
