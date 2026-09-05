/*
  Warnings:

  - A unique constraint covering the columns `[code]` on the table `Schedule` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `code` to the `Schedule` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Schedule" ADD COLUMN     "code" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Schedule_code_key" ON "Schedule"("code");
