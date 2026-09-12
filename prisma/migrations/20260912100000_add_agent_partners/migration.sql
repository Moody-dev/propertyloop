-- Agent Partner Programme.
--
-- Adds the house-inventory distinction to Listing, the AgentPartner record
-- behind /realtors/partners, partner attribution on Lead, and commissions.
--
-- Every column added to an existing table is nullable or defaulted, so this
-- is safe to run against live data: nothing already in the database changes
-- meaning. Existing listings become AGENT_OWN, which is what they are.

-- ─── Enums ──────────────────────────────────────────────────────────────
CREATE TYPE "ListingOwnership" AS ENUM ('AGENT_OWN', 'HOUSE');
CREATE TYPE "PartnerStatus" AS ENUM ('NEW', 'CONTACTED', 'VERIFIED', 'ACTIVE', 'DORMANT', 'REJECTED');
CREATE TYPE "PartnerExperience" AS ENUM ('NEW', 'ONE_TO_THREE', 'THREE_PLUS');
CREATE TYPE "PartnerCommissionStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID', 'REJECTED');

-- LeadSource gains PARTNER. ALTER TYPE ... ADD VALUE cannot run inside a
-- transaction block on older Postgres, but Prisma runs each migration file
-- in one, so IF NOT EXISTS keeps it idempotent on re-run.
ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'PARTNER';

-- StaffPermission gains the two partner grants.
ALTER TYPE "StaffPermission" ADD VALUE IF NOT EXISTS 'MANAGE_PARTNERS';
ALTER TYPE "StaffPermission" ADD VALUE IF NOT EXISTS 'APPROVE_COMMISSION';

-- ─── Listing ────────────────────────────────────────────────────────────
ALTER TABLE "Listing" ADD COLUMN "ownership" "ListingOwnership" NOT NULL DEFAULT 'AGENT_OWN';
CREATE INDEX "Listing_ownership_idx" ON "Listing"("ownership");

-- ─── AgentPartner ───────────────────────────────────────────────────────
CREATE TABLE "AgentPartner" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "PartnerStatus" NOT NULL DEFAULT 'NEW',
    "experience" "PartnerExperience",
    "agencyName" TEXT,
    "operatingState" TEXT,
    "referredById" TEXT,
    "ownerStaffId" TEXT,
    "passportPhotoUrl" TEXT,
    "bankCode" TEXT,
    "bankName" TEXT,
    "accountNumber" TEXT,
    "accountName" TEXT,
    "nin" TEXT,
    "tin" TEXT,
    "payerId" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "residentialAddress" TEXT,
    "residentialState" TEXT,
    "rcNumber" TEXT,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastContactAt" TIMESTAMP(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgentPartner_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentPartner_code_key" ON "AgentPartner"("code");
CREATE UNIQUE INDEX "AgentPartner_userId_key" ON "AgentPartner"("userId");
CREATE INDEX "AgentPartner_status_idx" ON "AgentPartner"("status");
CREATE INDEX "AgentPartner_ownerStaffId_idx" ON "AgentPartner"("ownerStaffId");
CREATE INDEX "AgentPartner_referredById_idx" ON "AgentPartner"("referredById");

ALTER TABLE "AgentPartner" ADD CONSTRAINT "AgentPartner_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentPartner" ADD CONSTRAINT "AgentPartner_referredById_fkey"
    FOREIGN KEY ("referredById") REFERENCES "AgentPartner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentPartner" ADD CONSTRAINT "AgentPartner_ownerStaffId_fkey"
    FOREIGN KEY ("ownerStaffId") REFERENCES "StaffProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Lead attribution ───────────────────────────────────────────────────
ALTER TABLE "Lead" ADD COLUMN "broughtByPartnerId" TEXT;
CREATE INDEX "Lead_broughtByPartnerId_idx" ON "Lead"("broughtByPartnerId");
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_broughtByPartnerId_fkey"
    FOREIGN KEY ("broughtByPartnerId") REFERENCES "AgentPartner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── PartnerCommission ──────────────────────────────────────────────────
CREATE TABLE "PartnerCommission" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "listingId" TEXT,
    "leadId" TEXT,
    "saleValueNaira" BIGINT NOT NULL,
    "ratePercent" DOUBLE PRECISION NOT NULL,
    "amountNaira" BIGINT NOT NULL,
    "status" "PartnerCommissionStatus" NOT NULL DEFAULT 'PENDING',
    "approvedByStaffId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PartnerCommission_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PartnerCommission_partnerId_idx" ON "PartnerCommission"("partnerId");
CREATE INDEX "PartnerCommission_status_idx" ON "PartnerCommission"("status");
CREATE INDEX "PartnerCommission_listingId_idx" ON "PartnerCommission"("listingId");

ALTER TABLE "PartnerCommission" ADD CONSTRAINT "PartnerCommission_partnerId_fkey"
    FOREIGN KEY ("partnerId") REFERENCES "AgentPartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerCommission" ADD CONSTRAINT "PartnerCommission_listingId_fkey"
    FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PartnerCommission" ADD CONSTRAINT "PartnerCommission_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PartnerCommission" ADD CONSTRAINT "PartnerCommission_approvedByStaffId_fkey"
    FOREIGN KEY ("approvedByStaffId") REFERENCES "StaffProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
