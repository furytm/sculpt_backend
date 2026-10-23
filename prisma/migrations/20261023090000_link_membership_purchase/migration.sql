ALTER TABLE "MemberMembership"
ADD COLUMN "membershipPurchaseId" TEXT;

CREATE UNIQUE INDEX "MemberMembership_membershipPurchaseId_key"
ON "MemberMembership"("membershipPurchaseId");

ALTER TABLE "MemberMembership"
ADD CONSTRAINT "MemberMembership_membershipPurchaseId_fkey"
FOREIGN KEY ("membershipPurchaseId")
REFERENCES "MembershipPurchase"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;