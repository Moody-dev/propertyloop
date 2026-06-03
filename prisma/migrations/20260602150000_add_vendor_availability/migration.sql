-- CreateTable
CREATE TABLE "VendorAvailability" (
    "id" TEXT NOT NULL,
    "vendorUserId" TEXT NOT NULL,
    "acceptingBookings" BOOLEAN NOT NULL DEFAULT true,
    "maxJobsPerDay" INTEGER NOT NULL DEFAULT 3,
    "responseCommitment" TEXT NOT NULL DEFAULT 'Within 1 hr',
    "schedule" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorBlackout" (
    "id" TEXT NOT NULL,
    "vendorUserId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorBlackout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VendorAvailability_vendorUserId_key" ON "VendorAvailability"("vendorUserId");

-- CreateIndex
CREATE INDEX "VendorBlackout_vendorUserId_idx" ON "VendorBlackout"("vendorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorBlackout_vendorUserId_date_key" ON "VendorBlackout"("vendorUserId", "date");

-- AddForeignKey
ALTER TABLE "VendorAvailability" ADD CONSTRAINT "VendorAvailability_vendorUserId_fkey" FOREIGN KEY ("vendorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBlackout" ADD CONSTRAINT "VendorBlackout_vendorUserId_fkey" FOREIGN KEY ("vendorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
