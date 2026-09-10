-- Team portal: staff profiles, permissions, deals, daily logs, production,
-- targets, ops tasks, and internal conversations.
--
-- Deliberately additive only. Every new column on an existing table is
-- nullable or has a default, so this applies to a live database without
-- rewriting Listing or Conversation and without a window where existing rows
-- are invalid. Nothing is dropped or renamed.

-- ─── Enums ──────────────────────────────────────────────────────────────────

CREATE TYPE "StaffRole" AS ENUM (
  'MD_CEO', 'GM', 'PROPERTY_LISTING', 'MARKETING', 'OPERATIONS',
  'AMBASSADOR', 'SECRETARY'
);

CREATE TYPE "Chapter" AS ENUM ('LAGOS', 'OSUN');

CREATE TYPE "StaffPermission" AS ENUM (
  'VIEW_REVENUE', 'VIEW_ALL_TARGETS', 'MANAGE_TARGETS', 'MANAGE_DEALS',
  'MANAGE_PROPERTIES', 'PUBLISH_PROPERTY', 'VERIFY_DOCUMENTS', 'MANAGE_LEADS',
  'QUALIFY_LEAD', 'MANAGE_CONTENT', 'HANDLE_OPS', 'REVIEW_KYC',
  'APPROVE_WITHDRAWAL', 'RESOLVE_DISPUTE', 'VIEW_ALL_LOGS', 'MANAGE_STAFF'
);

CREATE TYPE "DealStage" AS ENUM (
  'IDENTIFIED', 'CONTACTED', 'PRESENTATION_SENT', 'MEETING',
  'INVENTORY_RECEIVED', 'MANDATE_SIGNED', 'PUBLISHED', 'LOST'
);

CREATE TYPE "DealKind" AS ENUM (
  'DEVELOPER', 'ADVERTISER', 'FACILITY_MANAGEMENT', 'BUILDING_FINISHING',
  'REALTOR'
);

CREATE TYPE "MandateType" AS ENUM ('EXCLUSIVE', 'PRIMARY', 'OPEN', 'NONE');

CREATE TYPE "ShootStage" AS ENUM (
  'REQUESTED', 'SCHEDULED', 'PREPPED', 'FILMED', 'EDITING', 'PUBLISHED'
);

CREATE TYPE "ContentChannel" AS ENUM (
  'INSTAGRAM', 'LINKEDIN', 'WHATSAPP', 'TIKTOK', 'X'
);

CREATE TYPE "ContentKind" AS ENUM (
  'GRAPHIC', 'CAROUSEL', 'POST', 'VIDEO', 'CAMPAIGN'
);

CREATE TYPE "TargetUnit" AS ENUM ('COUNT', 'NAIRA', 'PERCENT');

CREATE TYPE "TargetProvenance" AS ENUM ('DATABASE', 'MANUAL');

CREATE TYPE "ConversationKind" AS ENUM (
  'CUSTOMER', 'STAFF_DIRECT', 'STAFF_GROUP', 'STAFF_THREAD'
);

-- ─── StaffProfile ───────────────────────────────────────────────────────────

CREATE TABLE "StaffProfile" (
  "id"               TEXT NOT NULL,
  "userId"           TEXT NOT NULL,
  "letter"           TEXT NOT NULL,
  "staffRole"        "StaffRole" NOT NULL,
  "chapter"          "Chapter" NOT NULL DEFAULT 'LAGOS',
  "secondaryChapter" "Chapter",
  "permissions"      "StaffPermission"[],
  "reportsToId"      TEXT,
  "active"           BOOLEAN NOT NULL DEFAULT true,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StaffProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StaffProfile_userId_key" ON "StaffProfile"("userId");
CREATE INDEX "StaffProfile_staffRole_idx" ON "StaffProfile"("staffRole");
CREATE INDEX "StaffProfile_chapter_idx" ON "StaffProfile"("chapter");
CREATE INDEX "StaffProfile_active_idx" ON "StaffProfile"("active");

ALTER TABLE "StaffProfile"
  ADD CONSTRAINT "StaffProfile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StaffProfile"
  ADD CONSTRAINT "StaffProfile_reportsToId_fkey"
  FOREIGN KEY ("reportsToId") REFERENCES "StaffProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Deal ───────────────────────────────────────────────────────────────────

CREATE TABLE "Deal" (
  "id"              TEXT NOT NULL,
  "company"         TEXT NOT NULL,
  "contactName"     TEXT NOT NULL,
  "contactPhone"    TEXT,
  "kind"            "DealKind" NOT NULL,
  "stage"           "DealStage" NOT NULL DEFAULT 'IDENTIFIED',
  "mandate"         "MandateType" NOT NULL DEFAULT 'NONE',
  "valueNaira"      BIGINT NOT NULL DEFAULT 0,
  "expectedUnits"   INTEGER NOT NULL DEFAULT 0,
  "ownerId"         TEXT NOT NULL,
  "chapter"         "Chapter" NOT NULL DEFAULT 'LAGOS',
  "mandateSignedAt" TIMESTAMP(3),
  "nextAction"      TEXT,
  "nextActionAt"    TIMESTAMP(3),
  "notes"           TEXT NOT NULL DEFAULT '',
  "lastActivityAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Deal_stage_idx" ON "Deal"("stage");
CREATE INDEX "Deal_ownerId_idx" ON "Deal"("ownerId");
CREATE INDEX "Deal_chapter_idx" ON "Deal"("chapter");
CREATE INDEX "Deal_kind_idx" ON "Deal"("kind");
CREATE INDEX "Deal_lastActivityAt_idx" ON "Deal"("lastActivityAt");

ALTER TABLE "Deal"
  ADD CONSTRAINT "Deal_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "StaffProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── DailyLog ───────────────────────────────────────────────────────────────

CREATE TABLE "DailyLog" (
  "id"          TEXT NOT NULL,
  "staffId"     TEXT NOT NULL,
  "day"         TEXT NOT NULL,
  "summary"     TEXT NOT NULL,
  "blockers"    TEXT NOT NULL DEFAULT '',
  "plan"        TEXT NOT NULL DEFAULT '',
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DailyLog_pkey" PRIMARY KEY ("id")
);

-- One entry per person per day is enforced here, not just in application code.
CREATE UNIQUE INDEX "DailyLog_staffId_day_key" ON "DailyLog"("staffId", "day");
CREATE INDEX "DailyLog_day_idx" ON "DailyLog"("day");

ALTER TABLE "DailyLog"
  ADD CONSTRAINT "DailyLog_staffId_fkey"
  FOREIGN KEY ("staffId") REFERENCES "StaffProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Shoot ──────────────────────────────────────────────────────────────────

CREATE TABLE "Shoot" (
  "id"             TEXT NOT NULL,
  "title"          TEXT NOT NULL,
  "location"       TEXT NOT NULL,
  "listingId"      TEXT,
  "stage"          "ShootStage" NOT NULL DEFAULT 'REQUESTED',
  "scheduledFor"   TIMESTAMP(3),
  "prepCompleteAt" TIMESTAMP(3),
  "presenterId"    TEXT NOT NULL,
  "secretaryId"    TEXT NOT NULL,
  "reshoot"        BOOLEAN NOT NULL DEFAULT false,
  "engagementRate" DOUBLE PRECISION,
  "publishedAt"    TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Shoot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Shoot_stage_idx" ON "Shoot"("stage");
CREATE INDEX "Shoot_presenterId_idx" ON "Shoot"("presenterId");
CREATE INDEX "Shoot_scheduledFor_idx" ON "Shoot"("scheduledFor");

ALTER TABLE "Shoot"
  ADD CONSTRAINT "Shoot_listingId_fkey"
  FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Shoot"
  ADD CONSTRAINT "Shoot_presenterId_fkey"
  FOREIGN KEY ("presenterId") REFERENCES "StaffProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Shoot"
  ADD CONSTRAINT "Shoot_secretaryId_fkey"
  FOREIGN KEY ("secretaryId") REFERENCES "StaffProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── ContentPiece ───────────────────────────────────────────────────────────

CREATE TABLE "ContentPiece" (
  "id"             TEXT NOT NULL,
  "title"          TEXT NOT NULL,
  "channel"        "ContentChannel" NOT NULL,
  "kind"           "ContentKind" NOT NULL,
  "publishedAt"    TIMESTAMP(3),
  "scheduledFor"   TIMESTAMP(3),
  "engagementRate" DOUBLE PRECISION,
  "leadsGenerated" INTEGER NOT NULL DEFAULT 0,
  "ownerId"        TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContentPiece_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContentPiece_ownerId_idx" ON "ContentPiece"("ownerId");
CREATE INDEX "ContentPiece_channel_idx" ON "ContentPiece"("channel");
CREATE INDEX "ContentPiece_publishedAt_idx" ON "ContentPiece"("publishedAt");

ALTER TABLE "ContentPiece"
  ADD CONSTRAINT "ContentPiece_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "StaffProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── StaffTarget ────────────────────────────────────────────────────────────

CREATE TABLE "StaffTarget" (
  "id"         TEXT NOT NULL,
  "staffId"    TEXT NOT NULL,
  "label"      TEXT NOT NULL,
  "min"        DOUBLE PRECISION NOT NULL,
  "max"        DOUBLE PRECISION NOT NULL,
  "actual"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "unit"       "TargetUnit" NOT NULL DEFAULT 'COUNT',
  "ceiling"    BOOLEAN NOT NULL DEFAULT false,
  "provenance" "TargetProvenance" NOT NULL DEFAULT 'MANUAL',
  "metricKey"  TEXT,
  "period"     TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StaffTarget_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StaffTarget_staffId_period_label_key"
  ON "StaffTarget"("staffId", "period", "label");
CREATE INDEX "StaffTarget_period_idx" ON "StaffTarget"("period");

ALTER TABLE "StaffTarget"
  ADD CONSTRAINT "StaffTarget_staffId_fkey"
  FOREIGN KEY ("staffId") REFERENCES "StaffProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── OpsTask ────────────────────────────────────────────────────────────────

CREATE TABLE "OpsTask" (
  "id"          TEXT NOT NULL,
  "subject"     TEXT NOT NULL,
  "urgent"      BOOLEAN NOT NULL DEFAULT false,
  "assigneeId"  TEXT,
  "resolved"    BOOLEAN NOT NULL DEFAULT false,
  "resolvedAt"  TIMESTAMP(3),
  "createdById" TEXT,
  "openedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OpsTask_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OpsTask_resolved_idx" ON "OpsTask"("resolved");
CREATE INDEX "OpsTask_assigneeId_idx" ON "OpsTask"("assigneeId");

ALTER TABLE "OpsTask"
  ADD CONSTRAINT "OpsTask_assigneeId_fkey"
  FOREIGN KEY ("assigneeId") REFERENCES "StaffProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Listing: sourcing attribution ──────────────────────────────────────────
-- agentId already records who OWNS a listing. Neither of these existed, so
-- "who brought this in" could not be answered from the database at all.
-- Both nullable: every existing listing predates the team portal.

ALTER TABLE "Listing" ADD COLUMN "sourcedByStaffId" TEXT;
ALTER TABLE "Listing" ADD COLUMN "fromDealId" TEXT;

CREATE INDEX "Listing_sourcedByStaffId_idx" ON "Listing"("sourcedByStaffId");
CREATE INDEX "Listing_fromDealId_idx" ON "Listing"("fromDealId");

ALTER TABLE "Listing"
  ADD CONSTRAINT "Listing_sourcedByStaffId_fkey"
  FOREIGN KEY ("sourcedByStaffId") REFERENCES "StaffProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Listing"
  ADD CONSTRAINT "Listing_fromDealId_fkey"
  FOREIGN KEY ("fromDealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Conversation: internal threads ─────────────────────────────────────────
-- isInternal defaults to false, so every existing conversation stays a
-- customer conversation and keeps appearing in the inbox exactly as before.
--
-- Note there is deliberately NO foreign key added for the pre-existing
-- listingId column: it has never had one, and some rows may point at listings
-- that were since deleted. Adding the constraint now could fail on live data.

ALTER TABLE "Conversation" ADD COLUMN "isInternal" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Conversation" ADD COLUMN "kind" "ConversationKind" NOT NULL DEFAULT 'CUSTOMER';
ALTER TABLE "Conversation" ADD COLUMN "title" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "dealId" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "leadId" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "shootId" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "resolvedAt" TIMESTAMP(3);

CREATE INDEX "Conversation_isInternal_kind_idx" ON "Conversation"("isInternal", "kind");
CREATE INDEX "Conversation_dealId_idx" ON "Conversation"("dealId");
CREATE INDEX "Conversation_leadId_idx" ON "Conversation"("leadId");
CREATE INDEX "Conversation_shootId_idx" ON "Conversation"("shootId");

ALTER TABLE "Conversation"
  ADD CONSTRAINT "Conversation_dealId_fkey"
  FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Conversation"
  ADD CONSTRAINT "Conversation_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Conversation"
  ADD CONSTRAINT "Conversation_shootId_fkey"
  FOREIGN KEY ("shootId") REFERENCES "Shoot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
