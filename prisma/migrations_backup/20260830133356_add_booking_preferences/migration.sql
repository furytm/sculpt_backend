-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "availableDays" TEXT[],
ADD COLUMN     "preferredStartDate" TIMESTAMP(3),
ADD COLUMN     "preferredTimes" TEXT[];
