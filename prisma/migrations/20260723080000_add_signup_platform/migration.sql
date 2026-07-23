-- Track which client (mobile app vs website) an account signed up from, so
-- the emailed verification link can route back to the right place.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "signupPlatform" TEXT;
