-- DropForeignKey
ALTER TABLE "MemberMembership"
DROP CONSTRAINT IF EXISTS "MemberMembership_bookingId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "MemberMembership_bookingId_key";

-- AlterTable
ALTER TABLE "MemberMembership"
DROP COLUMN IF EXISTS "bookingId";

-- AlterTable
ALTER TABLE "MembershipPurchase"
ADD COLUMN IF NOT EXISTS "firstClassId" TEXT,
ADD COLUMN IF NOT EXISTS "healthDeclarationAccepted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "healthDeclarationNotes" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MembershipPurchase_userId_idx"
ON "MembershipPurchase"("userId");

CREATE INDEX IF NOT EXISTS "MembershipPurchase_email_idx"
ON "MembershipPurchase"("email");

-- AddForeignKey (only if it does not already exist)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'Booking_memberMembershipId_fkey'
          AND conrelid = '"Booking"'::regclass
    ) THEN
        ALTER TABLE "Booking"
        ADD CONSTRAINT "Booking_memberMembershipId_fkey"
        FOREIGN KEY ("memberMembershipId")
        REFERENCES "MemberMembership"("id")
        ON DELETE SET NULL
        ON UPDATE CASCADE;
    END IF;
END $$;