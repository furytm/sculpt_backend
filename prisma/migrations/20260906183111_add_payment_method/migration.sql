-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('PAYMISH', 'OFFLINE');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'PAYMISH';
