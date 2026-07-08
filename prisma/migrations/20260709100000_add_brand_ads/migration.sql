-- Brand advertising: external brands pay a flat fee to run a creative in a
-- placement slot for a fixed window (self-serve via web, admin-reviewed).

-- CreateEnum
CREATE TYPE "AdPlacement" AS ENUM ('SPLASH', 'HOME_BANNER', 'HOME_FEED', 'SEARCH_INLINE');

-- CreateEnum
CREATE TYPE "AdStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'PAUSED', 'REJECTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "BrandAd" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "brandName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "imageUrl" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "body" TEXT,
    "ctaLabel" TEXT NOT NULL DEFAULT 'Learn more',
    "ctaUrl" TEXT NOT NULL,
    "placement" "AdPlacement" NOT NULL,
    "status" "AdStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "weeks" INTEGER NOT NULL DEFAULT 1,
    "amountNaira" INTEGER NOT NULL,
    "paymentRef" TEXT,
    "paidAt" TIMESTAMP(3),
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "adminNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandAd_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BrandAd_paymentRef_key" ON "BrandAd"("paymentRef");

-- CreateIndex
CREATE INDEX "BrandAd_placement_status_idx" ON "BrandAd"("placement", "status");

-- CreateIndex
CREATE INDEX "BrandAd_ownerUserId_idx" ON "BrandAd"("ownerUserId");

-- CreateIndex
CREATE INDEX "BrandAd_status_idx" ON "BrandAd"("status");

-- AddForeignKey
ALTER TABLE "BrandAd" ADD CONSTRAINT "BrandAd_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
