-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "budgetNaira" BIGINT,
ADD COLUMN     "firstRespondedAt" TIMESTAMP(3),
ADD COLUMN     "ownerStaffId" TEXT,
ADD COLUMN     "qualified" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "chapter" "Chapter",
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "units" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "unitsSold" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Lead_ownerStaffId_idx" ON "Lead"("ownerStaffId");

-- CreateIndex
CREATE INDEX "Lead_qualified_idx" ON "Lead"("qualified");

-- CreateIndex
CREATE INDEX "Listing_chapter_idx" ON "Listing"("chapter");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_ownerStaffId_fkey" FOREIGN KEY ("ownerStaffId") REFERENCES "StaffProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

