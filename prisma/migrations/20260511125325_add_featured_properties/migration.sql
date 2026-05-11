-- CreateTable
CREATE TABLE "FeaturedProperty" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "priceNaira" BIGINT NOT NULL,
    "priceLabel" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "propertyType" TEXT NOT NULL,
    "beds" INTEGER NOT NULL DEFAULT 0,
    "baths" INTEGER NOT NULL DEFAULT 0,
    "sqft" TEXT,
    "imageUrl" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeaturedProperty_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeaturedProperty_active_createdAt_idx" ON "FeaturedProperty"("active", "createdAt");
