-- Emails captured from the signup form before the account was created, so an
-- abandoned registration can be followed up on. No password is ever stored.

-- CreateTable
CREATE TABLE "PartialSignup" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "role" "Role",
    "step" TEXT,
    "source" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartialSignup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartialSignup_email_key" ON "PartialSignup"("email");

-- CreateIndex
CREATE INDEX "PartialSignup_completedAt_createdAt_idx" ON "PartialSignup"("completedAt", "createdAt");
