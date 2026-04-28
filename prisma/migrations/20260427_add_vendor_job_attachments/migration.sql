-- Add attachments[] to VendorJob so buyers can include images/videos at booking time
ALTER TABLE "VendorJob" ADD COLUMN "attachments" TEXT[] DEFAULT ARRAY[]::TEXT[];
