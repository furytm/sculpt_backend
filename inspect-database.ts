import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("\n========== DATABASE COLUMNS ==========\n");

  const columns = await prisma.$queryRaw<
    {
      table_name: string;
      column_name: string;
      data_type: string;
      is_nullable: string;
    }[]
  >`
    SELECT
      table_name,
      column_name,
      data_type,
      is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN (
        'MemberMembership',
        'MembershipPurchase',
        'Booking'
      )
    ORDER BY table_name, ordinal_position;
  `;

  console.table(columns);

  console.log("\n========== MEMBERSHIP BOOKING IDS ==========\n");

  const counts = await prisma.$queryRaw<
    {
      total_memberships: bigint;
      memberships_with_booking_id: bigint;
    }[]
  >`
    SELECT
      COUNT(*) AS total_memberships,
      COUNT("bookingId") AS memberships_with_booking_id
    FROM "MemberMembership";
  `;

  console.table(
    counts.map((item) => ({
      total_memberships: Number(item.total_memberships),
      memberships_with_booking_id: Number(
        item.memberships_with_booking_id
      ),
    }))
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());