-- CreateEnum
CREATE TYPE "EscrowStatus" AS ENUM ('NONE', 'LOCKED', 'RELEASED', 'DISPUTED', 'REFUNDED');

-- AlterTable: VendorProfile — media + availability
ALTER TABLE "VendorProfile"
  ADD COLUMN "bannerImage" TEXT,
  ADD COLUMN "portfolioImages" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "availableForHire" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable: VendorJob — buyer link, escrow, completion, dispute
ALTER TABLE "VendorJob"
  ADD COLUMN "buyerUserId" TEXT,
  ADD COLUMN "clientEmail" TEXT,
  ADD COLUMN "escrowId" TEXT,
  ADD COLUMN "escrowStatus" "EscrowStatus" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "escrowAmount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "vendorFee" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "platformFee" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "paymentMethod" TEXT,
  ADD COLUMN "completionProofImages" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "completionNotes" TEXT,
  ADD COLUMN "completedAt" TIMESTAMP(3),
  ADD COLUMN "confirmedAt" TIMESTAMP(3),
  ADD COLUMN "disputeReason" TEXT,
  ADD COLUMN "disputedAt" TIMESTAMP(3),
  ADD COLUMN "refundedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "VendorJob_escrowId_key" ON "VendorJob"("escrowId");
CREATE INDEX "VendorJob_buyerUserId_idx" ON "VendorJob"("buyerUserId");
CREATE INDEX "VendorJob_escrowStatus_idx" ON "VendorJob"("escrowStatus");

-- AddForeignKey
ALTER TABLE "VendorJob" ADD CONSTRAINT "VendorJob_buyerUserId_fkey"
  FOREIGN KEY ("buyerUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
