SELECT
    mp.id AS purchase_id,
    mp.email AS purchase_email,
    mp."userId" AS purchase_user_id,
    mp."paymentStatus",
    mp."paymentReference",
    mm.id AS member_membership_id,
    mm."userId" AS membership_user_id,
    mm.status AS membership_status,
    mm."startDate",
    mm."expiryDate",
    mm."creditsTotal",
    mm."creditsUsed"
FROM "MembershipPurchase" mp
LEFT JOIN "MemberMembership" mm
    ON mm."membershipPurchaseId" = mp.id
WHERE mp.id = 'cmw0elv8q000ji83mfh9095vn';