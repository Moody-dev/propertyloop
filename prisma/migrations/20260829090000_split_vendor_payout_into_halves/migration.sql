-- Split the vendor payout into two halves: a deposit released when the vendor
-- starts work, and the balance released when the buyer confirms completion.
--
-- Existing jobs are backfilled so their behaviour is unchanged: depositAmount
-- stays 0 and finalAmount carries the whole fee, so they still release in full
-- on confirmation and no deposit is ever owed on work already under way.

-- CreateEnum
CREATE TYPE "EarningKind" AS ENUM ('DEPOSIT', 'FINAL');

-- AlterTable
ALTER TABLE "VendorJob"
  ADD COLUMN "depositAmount"     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "finalAmount"       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "depositReleasedAt" TIMESTAMP(3);

-- Backfill: the entire existing fee is owed at confirmation.
UPDATE "VendorJob" SET "finalAmount" = "vendorFee" WHERE "finalAmount" = 0;

-- AlterTable
ALTER TABLE "VendorEarning"
  ADD COLUMN "kind" "EarningKind" NOT NULL DEFAULT 'FINAL';

-- Each job previously had at most one earning; it becomes that job's FINAL
-- half, so the old single-row unique constraint gives way to one per kind.
DROP INDEX IF EXISTS "VendorEarning_jobId_key";

-- CreateIndex
CREATE UNIQUE INDEX "VendorEarning_jobId_kind_key" ON "VendorEarning"("jobId", "kind");

-- CreateIndex
CREATE INDEX "VendorEarning_jobId_idx" ON "VendorEarning"("jobId");
