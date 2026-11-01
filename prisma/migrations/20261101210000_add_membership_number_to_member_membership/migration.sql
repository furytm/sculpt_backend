ALTER TABLE "MemberMembership"
ADD COLUMN "membershipNumber" TEXT;

CREATE INDEX "MemberMembership_membershipNumber_idx"
ON "MemberMembership"("membershipNumber");