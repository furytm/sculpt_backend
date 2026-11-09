
-- Add offline payment support to MembershipPurchase
ALTER TABLE "MembershipPurchase"
ADD COLUMN IF NOT EXISTS "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'PAYMISH';

ALTER TABLE "MembershipPurchase"
ADD COLUMN IF NOT EXISTS "paymentRejectionReason" TEXT;

-- Link MembershipActivation to MembershipPurchase
ALTER TABLE "MembershipActivation"
ADD COLUMN IF NOT EXISTS "membershipPurchaseId" TEXT;

-- Ensure each purchase can have only one activation
CREATE UNIQUE INDEX IF NOT EXISTS
"MembershipActivation_membershipPurchaseId_key"
ON "MembershipActivation"("membershipPurchaseId");

-- Add the foreign key relationship
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'MembershipActivation_membershipPurchaseId_fkey'
    ) THEN
        ALTER TABLE "MembershipActivation"
        ADD CONSTRAINT "MembershipActivation_membershipPurchaseId_fkey"
        FOREIGN KEY ("membershipPurchaseId")
        REFERENCES "MembershipPurchase"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE;
    END IF;
END $$;
