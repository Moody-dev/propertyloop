-- Vendor in-app wallet: released escrow now lands as an AVAILABLE balance the
-- vendor withdraws to their bank, instead of being auto-transferred on confirm.
ALTER TYPE "EarningStatus" ADD VALUE IF NOT EXISTS 'AVAILABLE';
