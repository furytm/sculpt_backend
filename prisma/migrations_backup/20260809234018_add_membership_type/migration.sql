-- CreateEnum
CREATE TYPE "MembershipType" AS ENUM ('GROUP', 'PRIVATE');

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "type" "MembershipType";
