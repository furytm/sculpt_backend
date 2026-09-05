/*
  Warnings:

  - Added the required column `className` to the `Schedule` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Schedule" ADD COLUMN     "className" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "Schedule_className_idx" ON "Schedule"("className");
