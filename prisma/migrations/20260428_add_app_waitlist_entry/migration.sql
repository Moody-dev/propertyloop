-- App waitlist (homepage "Coming Soon" mobile-app modal subscribers)
CREATE TABLE "AppWaitlistEntry" (
  "id"         TEXT         NOT NULL,
  "email"      TEXT         NOT NULL,
  "source"     TEXT,
  "notifiedAt" TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AppWaitlistEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppWaitlistEntry_email_key" ON "AppWaitlistEntry"("email");
CREATE INDEX        "AppWaitlistEntry_createdAt_idx" ON "AppWaitlistEntry"("createdAt");
