/*
  Warnings:

  - The values [WHATSAPP] on the enum `LeadSource` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "LeadSource_new" AS ENUM ('LISTING_PAGE', 'AGENT_PROFILE', 'PHONE', 'EMAIL', 'REFERRAL', 'OTHER');
ALTER TABLE "public"."Lead" ALTER COLUMN "source" DROP DEFAULT;
ALTER TABLE "Lead" ALTER COLUMN "source" TYPE "LeadSource_new" USING ("source"::text::"LeadSource_new");
ALTER TYPE "LeadSource" RENAME TO "LeadSource_old";
ALTER TYPE "LeadSource_new" RENAME TO "LeadSource";
DROP TYPE "public"."LeadSource_old";
ALTER TABLE "Lead" ALTER COLUMN "source" SET DEFAULT 'LISTING_PAGE';
COMMIT;

-- DropForeignKey
ALTER TABLE "VendorJob" DROP CONSTRAINT "VendorJob_vendorUserId_fkey";

-- AlterTable
ALTER TABLE "VendorJob" ALTER COLUMN "completionProofImages" DROP DEFAULT,
ALTER COLUMN "attachments" DROP DEFAULT;

-- AlterTable
ALTER TABLE "VendorProfile" ALTER COLUMN "portfolioImages" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "VendorJob_transferCode_idx" ON "VendorJob"("transferCode");

-- AddForeignKey
ALTER TABLE "VendorJob" ADD CONSTRAINT "VendorJob_vendorUserId_fkey" FOREIGN KEY ("vendorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
