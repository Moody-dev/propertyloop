-- CreateEnum
CREATE TYPE "ShortletBookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RentalApplicationStatus" AS ENUM ('PENDING', 'DEPOSIT_PAID', 'AGREEMENT_SIGNED', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "ShortletBooking" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "buyerUserId" TEXT,
    "guestName" TEXT NOT NULL,
    "guestPhone" TEXT NOT NULL,
    "guestEmail" TEXT,
    "guests" INTEGER NOT NULL,
    "checkIn" TIMESTAMP(3) NOT NULL,
    "checkOut" TIMESTAMP(3) NOT NULL,
    "nights" INTEGER NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "serviceFee" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "paymentMethod" TEXT,
    "escrowId" TEXT,
    "escrowStatus" "EscrowStatus" NOT NULL DEFAULT 'NONE',
    "status" "ShortletBookingStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShortletBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalApplication" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "buyerUserId" TEXT,
    "applicantName" TEXT NOT NULL,
    "applicantPhone" TEXT NOT NULL,
    "applicantEmail" TEXT,
    "deposit" INTEGER NOT NULL,
    "agencyFee" INTEGER NOT NULL,
    "legalFee" INTEGER NOT NULL,
    "serviceFee" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "leaseDuration" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "paymentMethod" TEXT,
    "escrowId" TEXT,
    "escrowStatus" "EscrowStatus" NOT NULL DEFAULT 'NONE',
    "status" "RentalApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "signedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentalApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShortletBooking_escrowId_key" ON "ShortletBooking"("escrowId");
CREATE INDEX "ShortletBooking_listingId_idx" ON "ShortletBooking"("listingId");
CREATE INDEX "ShortletBooking_buyerUserId_idx" ON "ShortletBooking"("buyerUserId");
CREATE INDEX "ShortletBooking_status_idx" ON "ShortletBooking"("status");

CREATE UNIQUE INDEX "RentalApplication_escrowId_key" ON "RentalApplication"("escrowId");
CREATE INDEX "RentalApplication_listingId_idx" ON "RentalApplication"("listingId");
CREATE INDEX "RentalApplication_buyerUserId_idx" ON "RentalApplication"("buyerUserId");
CREATE INDEX "RentalApplication_status_idx" ON "RentalApplication"("status");

-- AddForeignKey
ALTER TABLE "ShortletBooking" ADD CONSTRAINT "ShortletBooking_listingId_fkey"
  FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShortletBooking" ADD CONSTRAINT "ShortletBooking_buyerUserId_fkey"
  FOREIGN KEY ("buyerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RentalApplication" ADD CONSTRAINT "RentalApplication_listingId_fkey"
  FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RentalApplication" ADD CONSTRAINT "RentalApplication_buyerUserId_fkey"
  FOREIGN KEY ("buyerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
