-- DropIndex
DROP INDEX "FeaturedProperty_active_createdAt_idx";

-- AlterTable
ALTER TABLE "FeaturedProperty" ADD COLUMN     "displayOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "FeaturedProperty_active_displayOrder_createdAt_idx" ON "FeaturedProperty"("active", "displayOrder", "createdAt");
