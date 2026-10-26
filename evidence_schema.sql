\pset pager off
\d "MembershipPurchase"
\dT+ "PaymentMethod"
\d journals
\dT+ "JournalStatus"
SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at;
