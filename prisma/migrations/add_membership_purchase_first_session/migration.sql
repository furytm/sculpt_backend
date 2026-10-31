ALTER TABLE "MembershipPurchase"
ADD COLUMN "firstSessionId" TEXT;

ALTER TABLE "MembershipPurchase"
ADD CONSTRAINT "MembershipPurchase_firstSessionId_fkey"
FOREIGN KEY ("firstSessionId")
REFERENCES "ClassSession"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

CREATE INDEX "MembershipPurchase_firstSessionId_idx"
ON "MembershipPurchase"("firstSessionId");