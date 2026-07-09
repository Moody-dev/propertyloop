-- Manual vendor withdrawals: Paystack transfers aren't enabled on our account,
-- so a withdrawal now creates a PENDING request that an admin settles manually
-- (bank transfer) and then marks paid/rejected from the admin console.

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('PENDING', 'PAID', 'REJECTED');

-- CreateTable
CREATE TABLE "WithdrawalRequest" (
    "id" TEXT NOT NULL,
    "vendorUserId" TEXT NOT NULL,
    "amountNaira" INTEGER NOT NULL,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'PENDING',
    "bankName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "adminNote" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WithdrawalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WithdrawalRequest_vendorUserId_idx" ON "WithdrawalRequest"("vendorUserId");

-- CreateIndex
CREATE INDEX "WithdrawalRequest_status_idx" ON "WithdrawalRequest"("status");

-- AddForeignKey
ALTER TABLE "WithdrawalRequest" ADD CONSTRAINT "WithdrawalRequest_vendorUserId_fkey" FOREIGN KEY ("vendorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: link earnings to the withdrawal that contains them
ALTER TABLE "VendorEarning" ADD COLUMN "withdrawalRequestId" TEXT;

-- CreateIndex
CREATE INDEX "VendorEarning_withdrawalRequestId_idx" ON "VendorEarning"("withdrawalRequestId");

-- AddForeignKey
ALTER TABLE "VendorEarning" ADD CONSTRAINT "VendorEarning_withdrawalRequestId_fkey" FOREIGN KEY ("withdrawalRequestId") REFERENCES "WithdrawalRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: recipient code no longer required to save a payout account
ALTER TABLE "VendorBankAccount" ALTER COLUMN "paystackRecipientCode" DROP NOT NULL;
