-- CreateEnum
CREATE TYPE "SubscriptionTier" AS ENUM ('FOUNDING', 'STANDARD', 'PRO');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'GRACE_PERIOD', 'LAPSED', 'CANCELLED');

-- AlterTable
ALTER TABLE "AgentProfile" ADD COLUMN     "paystackCustomerCode" TEXT,
ADD COLUMN     "paystackSubscriptionCode" TEXT,
ADD COLUMN     "subscriptionRenewsAt" TIMESTAMP(3),
ADD COLUMN     "subscriptionStatus" "SubscriptionStatus",
ADD COLUMN     "subscriptionTier" "SubscriptionTier";

-- CreateTable
CREATE TABLE "SubscriptionPayment" (
    "id" TEXT NOT NULL,
    "agentProfileId" TEXT NOT NULL,
    "tier" "SubscriptionTier" NOT NULL,
    "amountKobo" INTEGER NOT NULL,
    "paystackRef" TEXT NOT NULL,
    "billingPeriodStart" TIMESTAMP(3) NOT NULL,
    "billingPeriodEnd" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPayment_paystackRef_key" ON "SubscriptionPayment"("paystackRef");

-- CreateIndex
CREATE INDEX "SubscriptionPayment_agentProfileId_idx" ON "SubscriptionPayment"("agentProfileId");

-- AddForeignKey
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "AgentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
