import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.$queryRaw<
    { total: bigint; orphaned: bigint }[]
  >`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (
        WHERE b."memberMembershipId" IS NOT NULL
          AND mm."id" IS NULL
      ) AS orphaned
    FROM "Booking" b
    LEFT JOIN "MemberMembership" mm
      ON mm."id" = b."memberMembershipId";
  `;

  console.table(
    result.map((row) => ({
      totalBookings: Number(row.total),
      orphanedMembershipLinks: Number(row.orphaned),
    }))
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());