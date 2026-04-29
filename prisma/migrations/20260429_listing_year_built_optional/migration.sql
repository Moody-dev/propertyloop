-- Make Listing.yearBuilt optional. Older properties often don't know an
-- exact year and the agent shouldn't be forced to guess.
ALTER TABLE "Listing" ALTER COLUMN "yearBuilt" DROP NOT NULL;
