-- CreateEnum
CREATE TYPE "DisputeAuthorRole" AS ENUM ('CUSTOMER', 'VENDOR', 'SYSTEM', 'ADMIN');

-- CreateTable
CREATE TABLE "JobDisputeMessage" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "senderUserId" TEXT,
    "role" "DisputeAuthorRole" NOT NULL,
    "body" TEXT NOT NULL,
    "attachments" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobDisputeMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobDisputeMessage_jobId_idx" ON "JobDisputeMessage"("jobId");

-- AddForeignKey
ALTER TABLE "JobDisputeMessage" ADD CONSTRAINT "JobDisputeMessage_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "VendorJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobDisputeMessage" ADD CONSTRAINT "JobDisputeMessage_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
