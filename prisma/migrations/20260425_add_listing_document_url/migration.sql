-- Add url column to ListingDocument so file storage URLs can be persisted
ALTER TABLE "ListingDocument" ADD COLUMN "url" TEXT;
