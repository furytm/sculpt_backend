/*
  Warnings:

  - A unique constraint covering the columns `[bookingFlowTokenHash]` on the table `Booking` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "bookingFlowTokenHash" TEXT;

-- AlterTable
ALTER TABLE "HealthSafetyForm" ADD COLUMN     "accepted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "declarationVersion" TEXT,
ADD COLUMN     "notes" TEXT,
ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Schedule" ADD COLUMN     "capacity" INTEGER NOT NULL DEFAULT 5;

-- CreateIndex
CREATE UNIQUE INDEX "Booking_bookingFlowTokenHash_key" ON "Booking"("bookingFlowTokenHash");
