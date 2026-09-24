-- AlterTable
ALTER TABLE "MemberMembership" ALTER COLUMN "userId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "MembershipActivation" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "memberMembershipId" TEXT NOT NULL,
    "membershipNumber" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MembershipActivation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MembershipActivation_bookingId_key" ON "MembershipActivation"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipActivation_memberMembershipId_key" ON "MembershipActivation"("memberMembershipId");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipActivation_membershipNumber_key" ON "MembershipActivation"("membershipNumber");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipActivation_tokenHash_key" ON "MembershipActivation"("tokenHash");

-- CreateIndex
CREATE INDEX "MembershipActivation_expiresAt_idx" ON "MembershipActivation"("expiresAt");

-- AddForeignKey
ALTER TABLE "MembershipActivation" ADD CONSTRAINT "MembershipActivation_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipActivation" ADD CONSTRAINT "MembershipActivation_memberMembershipId_fkey" FOREIGN KEY ("memberMembershipId") REFERENCES "MemberMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
