-- Feed post reports — persists "Report post" from the feed 3-dot menu.

-- CreateTable
CREATE TABLE "FeedReport" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "reporterId" TEXT,
    "reason" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FeedReport_status_idx" ON "FeedReport"("status");
CREATE UNIQUE INDEX "FeedReport_postId_reporterId_key" ON "FeedReport"("postId", "reporterId");

-- AddForeignKey
ALTER TABLE "FeedReport" ADD CONSTRAINT "FeedReport_postId_fkey" FOREIGN KEY ("postId") REFERENCES "FeedPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedReport" ADD CONSTRAINT "FeedReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

