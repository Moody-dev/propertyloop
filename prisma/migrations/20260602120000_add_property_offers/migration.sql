-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('PENDING', 'COUNTERED', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "OfferFinancing" AS ENUM ('CASH', 'OWN_FINANCING');

-- CreateEnum
CREATE TYPE "OfferActor" AS ENUM ('BUYER', 'AGENT');

-- CreateEnum
CREATE TYPE "OfferEventType" AS ENUM ('OFFER', 'COUNTER', 'ACCEPT', 'DECLINE', 'WITHDRAW', 'EXPIRE');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseStepState" AS ENUM ('DONE', 'ACTIVE', 'TODO');

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "amountNaira" BIGINT NOT NULL,
    "financing" "OfferFinancing" NOT NULL DEFAULT 'CASH',
    "note" TEXT,
    "closeDate" TIMESTAMP(3),
    "subjectToInspection" BOOLEAN NOT NULL DEFAULT true,
    "status" "OfferStatus" NOT NULL DEFAULT 'PENDING',
    "currentAmountNaira" BIGINT NOT NULL,
    "lastActor" "OfferActor" NOT NULL DEFAULT 'BUYER',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferEvent" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "type" "OfferEventType" NOT NULL,
    "actor" "OfferActor" NOT NULL,
    "amountNaira" BIGINT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyPurchase" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "agreedAmountNaira" BIGINT NOT NULL,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropertyPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseStep" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "state" "PurchaseStepState" NOT NULL DEFAULT 'TODO',
    "eta" TEXT,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PurchaseStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Offer_buyerId_idx" ON "Offer"("buyerId");

-- CreateIndex
CREATE INDEX "Offer_agentId_idx" ON "Offer"("agentId");

-- CreateIndex
CREATE INDEX "Offer_listingId_idx" ON "Offer"("listingId");

-- CreateIndex
CREATE INDEX "Offer_status_idx" ON "Offer"("status");

-- CreateIndex
CREATE INDEX "OfferEvent_offerId_idx" ON "OfferEvent"("offerId");

-- CreateIndex
CREATE UNIQUE INDEX "PropertyPurchase_offerId_key" ON "PropertyPurchase"("offerId");

-- CreateIndex
CREATE INDEX "PropertyPurchase_buyerId_idx" ON "PropertyPurchase"("buyerId");

-- CreateIndex
CREATE INDEX "PropertyPurchase_agentId_idx" ON "PropertyPurchase"("agentId");

-- CreateIndex
CREATE INDEX "PurchaseStep_purchaseId_idx" ON "PurchaseStep"("purchaseId");

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferEvent" ADD CONSTRAINT "OfferEvent_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyPurchase" ADD CONSTRAINT "PropertyPurchase_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyPurchase" ADD CONSTRAINT "PropertyPurchase_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyPurchase" ADD CONSTRAINT "PropertyPurchase_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyPurchase" ADD CONSTRAINT "PropertyPurchase_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseStep" ADD CONSTRAINT "PurchaseStep_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "PropertyPurchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
