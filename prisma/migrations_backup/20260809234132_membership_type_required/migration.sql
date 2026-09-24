/*
  Warnings:

  - Made the column `type` on table `Membership` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Membership" ALTER COLUMN "type" SET NOT NULL;
