-- Marketplace: category commission, immediate split payout, refunds & disputes.
--
-- Entirely additive — new enum values, new columns (all nullable or defaulted),
-- two new enums and one new table. No existing column changes type and no row
-- is rewritten, so this is safe to run against live data.

-- ─── New staff permission ───────────────────────────────────────────────
ALTER TYPE "StaffPermission" ADD VALUE IF NOT EXISTS 'MANAGE_MARKETPLACE';

-- ─── New order status ───────────────────────────────────────────────────
ALTER TYPE "MarketplaceOrderStatus" ADD VALUE IF NOT EXISTS 'DISPUTED';

-- ─── New enums ──────────────────────────────────────────────────────────
CREATE TYPE "MarketplacePayoutStatus" AS ENUM ('PAID_OUT', 'OWED', 'REFUNDED');
CREATE TYPE "MarketplaceDisputeStatus" AS ENUM ('OPEN', 'RESOLVED_REFUND', 'RESOLVED_REJECTED', 'CANCELLED');

-- ─── VendorBankAccount: subaccount for split payouts ────────────────────
ALTER TABLE "VendorBankAccount" ADD COLUMN "paystackSubaccountCode" TEXT;

-- ─── MarketplaceStore: negotiated commission override ───────────────────
ALTER TABLE "MarketplaceStore" ADD COLUMN "commissionPctOverride" INTEGER;

-- ─── MarketplaceOrder: refund bookkeeping ───────────────────────────────
ALTER TABLE "MarketplaceOrder" ADD COLUMN "refundedNaira" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MarketplaceOrder" ADD COLUMN "refundedAt" TIMESTAMP(3);

-- ─── MarketplaceOrderItem: category + payout tracking ───────────────────
ALTER TABLE "MarketplaceOrderItem" ADD COLUMN "category" TEXT NOT NULL DEFAULT '';
ALTER TABLE "MarketplaceOrderItem" ADD COLUMN "payoutStatus" "MarketplacePayoutStatus" NOT NULL DEFAULT 'OWED';
ALTER TABLE "MarketplaceOrderItem" ADD COLUMN "paystackSubaccount" TEXT;

-- ─── MarketplaceDispute ─────────────────────────────────────────────────
CREATE TABLE "MarketplaceDispute" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "raisedByUserId" TEXT,
    "reason" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "status" "MarketplaceDisputeStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedByStaffId" TEXT,
    "resolutionNote" TEXT,
    "refundNaira" INTEGER NOT NULL DEFAULT 0,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceDispute_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MarketplaceDispute_orderId_idx" ON "MarketplaceDispute"("orderId");
CREATE INDEX "MarketplaceDispute_status_idx" ON "MarketplaceDispute"("status");

ALTER TABLE "MarketplaceDispute"
    ADD CONSTRAINT "MarketplaceDispute_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "MarketplaceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MarketplaceDispute"
    ADD CONSTRAINT "MarketplaceDispute_raisedByUserId_fkey"
    FOREIGN KEY ("raisedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
