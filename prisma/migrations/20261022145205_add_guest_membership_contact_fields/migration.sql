-- CreateEnum
CREATE TYPE "JournalStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'PAYSTACK';

-- AlterTable
ALTER TABLE "MembershipPurchase" ADD COLUMN     "fullName" TEXT,
ADD COLUMN     "phone" TEXT;

-- CreateTable
CREATE TABLE "journals" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "coverImage" TEXT NOT NULL,
    "authorName" TEXT NOT NULL DEFAULT 'Sculpt LAB',
    "status" "JournalStatus" NOT NULL DEFAULT 'DRAFT',
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "journals_slug_key" ON "journals"("slug");

-- CreateIndex
CREATE INDEX "journals_status_publishedAt_idx" ON "journals"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "journals_isFeatured_status_idx" ON "journals"("isFeatured", "status");

-- CreateIndex
CREATE INDEX "MembershipPurchase_userId_idx" ON "MembershipPurchase"("userId");

-- CreateIndex
CREATE INDEX "MembershipPurchase_email_idx" ON "MembershipPurchase"("email");
