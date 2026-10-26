ALTER TABLE "MembershipPurchase"
ADD COLUMN "email" TEXT;

UPDATE "MembershipPurchase" AS mp
SET "email" = u."email"
FROM "User" AS u
WHERE mp."userId" = u."id";

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "MembershipPurchase"
        WHERE "email" IS NULL
    ) THEN
        RAISE EXCEPTION
            'Cannot migrate: some MembershipPurchase records have no email';
    END IF;
END $$;

ALTER TABLE "MembershipPurchase"
ALTER COLUMN "email" SET NOT NULL;

ALTER TABLE "MembershipPurchase"
ALTER COLUMN "userId" DROP NOT NULL;

ALTER TABLE "MembershipPurchase"
DROP CONSTRAINT "MembershipPurchase_userId_fkey";

ALTER TABLE "MembershipPurchase"
ADD CONSTRAINT "MembershipPurchase_userId_fkey"
FOREIGN KEY ("userId")
REFERENCES "User"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
CREATE INDEX "MembershipPurchase_email_idx"
ON "MembershipPurchase"("email");