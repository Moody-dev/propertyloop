-- Add vendorUser relation to Bookmark model
ALTER TABLE "Bookmark" ADD CONSTRAINT "Bookmark_vendorUserId_fkey" FOREIGN KEY ("vendorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
