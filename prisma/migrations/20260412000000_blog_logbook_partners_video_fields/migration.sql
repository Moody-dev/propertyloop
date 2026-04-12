-- AlterEnum: Remove WHATSAPP from LeadSource
-- (Note: Postgres enums require recreation; handled by Prisma migrate in prod)

-- AlterTable: Add fields to BuyerProfile
ALTER TABLE "BuyerProfile" ADD COLUMN "lookingFor" TEXT;
ALTER TABLE "BuyerProfile" ADD COLUMN "budgetRange" TEXT;

-- AlterTable: Add video tour fields to Listing
ALTER TABLE "Listing" ADD COLUMN "videoThumbnail" TEXT;
ALTER TABLE "Listing" ADD COLUMN "videoDuration" TEXT;
ALTER TABLE "Listing" ADD COLUMN "videoViewCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: Add negotiation/booking fields to VendorJob
ALTER TABLE "VendorJob" ADD COLUMN "negotiationNotes" TEXT;
ALTER TABLE "VendorJob" ADD COLUMN "preferredTime" TEXT;

-- CreateEnum
CREATE TYPE "BlogCategory" AS ENUM ('MARKET_INSIGHTS', 'GUIDES', 'PRODUCT_UPDATES', 'AGENT_TIPS');

-- CreateTable
CREATE TABLE "BlogPost" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "content" TEXT[],
    "category" "BlogCategory" NOT NULL,
    "image" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "avatar" TEXT,
    "readTime" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlogPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LogbookEntry" (
    "id" TEXT NOT NULL,
    "listingId" TEXT,
    "jobId" TEXT,
    "ownerUserId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "vendorName" TEXT NOT NULL,
    "vendorId" TEXT,
    "cost" INTEGER NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LogbookEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Partner" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT NOT NULL,
    "website" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BlogPost_slug_key" ON "BlogPost"("slug");
CREATE INDEX "BlogPost_category_idx" ON "BlogPost"("category");
CREATE INDEX "BlogPost_published_idx" ON "BlogPost"("published");

-- CreateIndex
CREATE UNIQUE INDEX "LogbookEntry_jobId_key" ON "LogbookEntry"("jobId");
CREATE INDEX "LogbookEntry_listingId_idx" ON "LogbookEntry"("listingId");
CREATE INDEX "LogbookEntry_ownerUserId_idx" ON "LogbookEntry"("ownerUserId");

-- AddForeignKey
ALTER TABLE "LogbookEntry" ADD CONSTRAINT "LogbookEntry_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LogbookEntry" ADD CONSTRAINT "LogbookEntry_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "VendorJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LogbookEntry" ADD CONSTRAINT "LogbookEntry_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
