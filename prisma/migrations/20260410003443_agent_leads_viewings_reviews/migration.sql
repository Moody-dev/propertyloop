-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'VIEWING_SCHEDULED', 'NEGOTIATING', 'CONVERTED', 'LOST');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('LISTING_PAGE', 'AGENT_PROFILE', 'PHONE', 'WHATSAPP', 'EMAIL', 'REFERRAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ViewingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('PENDING_REVIEW', 'ACTIVE', 'PAUSED', 'SOLD', 'RENTED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "status" "ListingStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
ADD COLUMN     "viewsCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "virtualTourUrl" TEXT;

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "buyerUserId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT NOT NULL,
    "message" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "source" "LeadSource" NOT NULL DEFAULT 'LISTING_PAGE',
    "notes" TEXT,
    "contactedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Viewing" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "buyerUserId" TEXT,
    "clientName" TEXT NOT NULL,
    "clientPhone" TEXT NOT NULL,
    "clientEmail" TEXT,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" "ViewingStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Viewing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentReview" (
    "id" TEXT NOT NULL,
    "agentUserId" TEXT NOT NULL,
    "reviewerUserId" TEXT,
    "reviewerName" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lead_agentId_idx" ON "Lead"("agentId");

-- CreateIndex
CREATE INDEX "Lead_listingId_idx" ON "Lead"("listingId");

-- CreateIndex
CREATE INDEX "Lead_status_idx" ON "Lead"("status");

-- CreateIndex
CREATE INDEX "Viewing_agentId_idx" ON "Viewing"("agentId");

-- CreateIndex
CREATE INDEX "Viewing_listingId_idx" ON "Viewing"("listingId");

-- CreateIndex
CREATE INDEX "Viewing_scheduledFor_idx" ON "Viewing"("scheduledFor");

-- CreateIndex
CREATE INDEX "Viewing_status_idx" ON "Viewing"("status");

-- CreateIndex
CREATE INDEX "AgentReview_agentUserId_idx" ON "AgentReview"("agentUserId");

-- CreateIndex
CREATE INDEX "Listing_status_idx" ON "Listing"("status");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_buyerUserId_fkey" FOREIGN KEY ("buyerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Viewing" ADD CONSTRAINT "Viewing_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Viewing" ADD CONSTRAINT "Viewing_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Viewing" ADD CONSTRAINT "Viewing_buyerUserId_fkey" FOREIGN KEY ("buyerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentReview" ADD CONSTRAINT "AgentReview_agentUserId_fkey" FOREIGN KEY ("agentUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentReview" ADD CONSTRAINT "AgentReview_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
