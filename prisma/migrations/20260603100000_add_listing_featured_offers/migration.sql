-- Add per-listing "Featured placement" (Pro perk) and "Accept offers" flags,
-- surfaced on the agent dashboard's Manage Listing view.
ALTER TABLE "Listing" ADD COLUMN "featured" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Listing" ADD COLUMN "openToOffers" BOOLEAN NOT NULL DEFAULT false;
