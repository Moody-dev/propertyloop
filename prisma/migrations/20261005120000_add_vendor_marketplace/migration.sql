-- Vendor Marketplace.
--
-- Branded storefronts owned by VENDOR users, their products, and multi-vendor
-- orders paid through Paystack. PropertyLoop takes a per-store commission; the
-- remainder is owed to the vendor (settled via the existing manual-withdrawal
-- model, so no Paystack Transfer is required).
--
-- Entirely additive: new enum, four new tables, no change to any existing
-- table or row. Safe to run against live data.

-- ─── Enum ───────────────────────────────────────────────────────────────
CREATE TYPE "MarketplaceOrderStatus" AS ENUM ('PENDING', 'PAID', 'FULFILLED', 'CANCELLED', 'REFUNDED');

-- ─── MarketplaceStore ───────────────────────────────────────────────────
CREATE TABLE "MarketplaceStore" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT NOT NULL,
    "bio" TEXT NOT NULL,
    "logo" TEXT NOT NULL,
    "banner" TEXT NOT NULL,
    "accent" TEXT NOT NULL DEFAULT '#2b4e3b',
    "category" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "established" TEXT NOT NULL DEFAULT '',
    "commissionPct" INTEGER NOT NULL DEFAULT 7,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reviewsCount" INTEGER NOT NULL DEFAULT 0,
    "ordersFulfilled" INTEGER NOT NULL DEFAULT 0,
    "responseTime" TEXT NOT NULL DEFAULT 'within a day',
    "deliveryAreas" TEXT[],
    "policies" JSONB NOT NULL DEFAULT '[]',
    "promo" JSONB,
    "collections" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceStore_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketplaceStore_slug_key" ON "MarketplaceStore"("slug");
CREATE INDEX "MarketplaceStore_ownerUserId_idx" ON "MarketplaceStore"("ownerUserId");
CREATE INDEX "MarketplaceStore_category_idx" ON "MarketplaceStore"("category");
CREATE INDEX "MarketplaceStore_active_idx" ON "MarketplaceStore"("active");

-- ─── MarketplaceProduct ─────────────────────────────────────────────────
CREATE TABLE "MarketplaceProduct" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priceNaira" INTEGER NOT NULL,
    "compareAtNaira" INTEGER,
    "category" TEXT NOT NULL,
    "coverImage" TEXT NOT NULL,
    "gallery" TEXT[],
    "specs" JSONB NOT NULL DEFAULT '[]',
    "options" JSONB NOT NULL DEFAULT '[]',
    "tag" TEXT,
    "bulkEligible" BOOLEAN NOT NULL DEFAULT false,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reviewsCount" INTEGER NOT NULL DEFAULT 0,
    "inStock" BOOLEAN NOT NULL DEFAULT true,
    "stockQty" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceProduct_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketplaceProduct_slug_key" ON "MarketplaceProduct"("slug");
CREATE INDEX "MarketplaceProduct_storeId_idx" ON "MarketplaceProduct"("storeId");
CREATE INDEX "MarketplaceProduct_category_idx" ON "MarketplaceProduct"("category");
CREATE INDEX "MarketplaceProduct_active_idx" ON "MarketplaceProduct"("active");

-- ─── MarketplaceOrder ───────────────────────────────────────────────────
CREATE TABLE "MarketplaceOrder" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "buyerUserId" TEXT,
    "buyerName" TEXT NOT NULL,
    "buyerEmail" TEXT NOT NULL,
    "buyerPhone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "notes" TEXT,
    "subtotal" INTEGER NOT NULL,
    "deliveryFee" INTEGER NOT NULL,
    "platformFee" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "status" "MarketplaceOrderStatus" NOT NULL DEFAULT 'PENDING',
    "paystackRef" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketplaceOrder_orderNumber_key" ON "MarketplaceOrder"("orderNumber");
CREATE UNIQUE INDEX "MarketplaceOrder_paystackRef_key" ON "MarketplaceOrder"("paystackRef");
CREATE INDEX "MarketplaceOrder_buyerUserId_idx" ON "MarketplaceOrder"("buyerUserId");
CREATE INDEX "MarketplaceOrder_status_idx" ON "MarketplaceOrder"("status");

-- ─── MarketplaceOrderItem ───────────────────────────────────────────────
CREATE TABLE "MarketplaceOrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "storeName" TEXT NOT NULL,
    "vendorUserId" TEXT NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "options" JSONB,
    "commissionPct" INTEGER NOT NULL,
    "commissionNaira" INTEGER NOT NULL,
    "vendorNetNaira" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketplaceOrderItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MarketplaceOrderItem_orderId_idx" ON "MarketplaceOrderItem"("orderId");
CREATE INDEX "MarketplaceOrderItem_storeId_idx" ON "MarketplaceOrderItem"("storeId");
CREATE INDEX "MarketplaceOrderItem_vendorUserId_idx" ON "MarketplaceOrderItem"("vendorUserId");

-- ─── Foreign keys ───────────────────────────────────────────────────────
ALTER TABLE "MarketplaceStore" ADD CONSTRAINT "MarketplaceStore_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MarketplaceProduct" ADD CONSTRAINT "MarketplaceProduct_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "MarketplaceStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MarketplaceOrder" ADD CONSTRAINT "MarketplaceOrder_buyerUserId_fkey"
    FOREIGN KEY ("buyerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MarketplaceOrderItem" ADD CONSTRAINT "MarketplaceOrderItem_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "MarketplaceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MarketplaceOrderItem" ADD CONSTRAINT "MarketplaceOrderItem_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "MarketplaceProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MarketplaceOrderItem" ADD CONSTRAINT "MarketplaceOrderItem_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "MarketplaceStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
