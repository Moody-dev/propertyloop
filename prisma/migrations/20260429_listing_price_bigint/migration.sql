-- Move naira price columns from int4 (max ~₦2.1B) to int8 / BigInt.
-- Existing values fit trivially; ALTER TYPE int → bigint is a no-loss
-- promotion in Postgres.

ALTER TABLE "Listing"
  ALTER COLUMN "priceNaira" TYPE BIGINT;

ALTER TABLE "ListingPriceHistory"
  ALTER COLUMN "oldPrice" TYPE BIGINT,
  ALTER COLUMN "newPrice" TYPE BIGINT;
