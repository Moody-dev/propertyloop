ALTER TABLE "WaitlistEntry" ADD COLUMN "activated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WaitlistEntry" ADD COLUMN "activatedAt" TIMESTAMP(3);
