-- Move any agents currently in GRACE_PERIOD to LAPSED before dropping the value
UPDATE "AgentProfile"
SET "subscriptionStatus" = 'LAPSED'
WHERE "subscriptionStatus" = 'GRACE_PERIOD';

-- Recreate the enum without GRACE_PERIOD
ALTER TYPE "SubscriptionStatus" RENAME TO "SubscriptionStatus_old";

CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'LAPSED', 'CANCELLED');

ALTER TABLE "AgentProfile"
  ALTER COLUMN "subscriptionStatus" TYPE "SubscriptionStatus"
  USING ("subscriptionStatus"::text::"SubscriptionStatus");

DROP TYPE "SubscriptionStatus_old";
