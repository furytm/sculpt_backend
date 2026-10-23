SELECT
  column_name,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'MembershipPurchase'
  AND column_name IN ('fullName', 'phone');
