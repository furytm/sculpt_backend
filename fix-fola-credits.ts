
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const EMAIL = "me@jemimabenson.com";
const USER_ID = "cmvh3qsyq0004ga33l778q3ir";

const PAYMENT_REFERENCES = [
  "SL-1792525982531-cca65c26",
  "SL-1794847708960-7df41138",
];

const OLD_BOOKING_ID = "cmvh3osnk0001ga33hiyer7yg";
const NEW_BOOKING_ID = "cmwji1kke000jtk300f8x18wh";
const PURCHASE_ID = "cmwjhzfoi000ftk30x0sbdqj1";
const MEMBER_MEMBERSHIP_ID = "cmwji1kic000htk30z8taz66w";

async function main() {
  console.log("\n========== JEMIMA ACCOUNT CHECK ==========\n");

  // 1. Actual registered user account
  const users = await prisma.$queryRaw<any[]>`
    SELECT
      u."id",
      u."fullName",
      u."email",
      u."phone",
      u."createdAt",
      u."updatedAt"
    FROM "User" u
    WHERE LOWER(u."email") = LOWER(${EMAIL})
       OR u."id" = ${USER_ID};
  `;

  console.log("1. USER ACCOUNT:");
  console.log(JSON.stringify(users, null, 2));

  // 2. Membership plan and member membership
  const memberships = await prisma.$queryRaw<any[]>`
    SELECT
      mm."id" AS "memberMembershipId",
      mm."userId",
      mm."membershipId",
      m."name" AS "membershipName",
      m."slug" AS "membershipSlug",
      m."price",
      m."classLimit",
      mm."creditsTotal",
      mm."creditsUsed",
      CASE
        WHEN mm."creditsTotal" IS NULL THEN NULL
        ELSE mm."creditsTotal" - mm."creditsUsed"
      END AS "remainingCredits",
      mm."startDate",
      mm."expiryDate",
      mm."status"::text AS "status",
      mm."membershipPurchaseId",
      mm."createdAt",
      mm."updatedAt"
    FROM "MemberMembership" mm
    LEFT JOIN "Membership" m
      ON m."id" = mm."membershipId"
    WHERE mm."id" = ${MEMBER_MEMBERSHIP_ID}
       OR mm."userId" = ${USER_ID}
    ORDER BY mm."createdAt" DESC;
  `;

  console.log("\n2. MEMBERSHIP DETAILS:");
  console.log(JSON.stringify(memberships, null, 2));


  // 3. Both bookings — retrieve actual database columns
  const bookings = await prisma.$queryRaw<any[]>`
    SELECT *
    FROM "Booking"
    WHERE "id" IN (${OLD_BOOKING_ID}, ${NEW_BOOKING_ID})
       OR LOWER("email") = LOWER(${EMAIL})
    ORDER BY "createdAt" ASC;
  `;

  console.log("\n3. BOOKINGS:");
  console.log(JSON.stringify(bookings, null, 2));


  // 4. Membership purchase
  const purchases = await prisma.$queryRaw<any[]>`
    SELECT *
    FROM "MembershipPurchase"
    WHERE "id" = ${PURCHASE_ID}
       OR "userId" = ${USER_ID}
       OR LOWER("email") = LOWER(${EMAIL})
       OR "paymentReference" IN (
         ${PAYMENT_REFERENCES[0]},
         ${PAYMENT_REFERENCES[1]}
       )
    ORDER BY "createdAt" ASC;
  `;

  console.log("\n4. MEMBERSHIP PURCHASES:");
  console.log(JSON.stringify(purchases, null, 2));

  // 5. Discover payment-related tables and search exact references.
  // This avoids assuming the payment model/table name.
  const columns = await prisma.$queryRaw<
    Array<{ table_name: string; column_name: string }>
  >`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        LOWER(column_name) LIKE '%reference%'
        OR LOWER(column_name) LIKE '%payment%'
      )
    ORDER BY table_name, column_name;
  `;

  console.log("\n5. PAYMENT-RELATED COLUMNS:");
  console.log(JSON.stringify(columns, null, 2));

  const candidateColumns = columns.filter((c) =>
    /reference|paymentreference/i.test(c.column_name)
  );

  const paymentMatches: Array<{
    table: string;
    column: string;
    rows: unknown[];
  }> = [];

  for (const item of candidateColumns) {
    const table = `"${item.table_name.replace(/"/g, '""')}"`;
    const column = `"${item.column_name.replace(/"/g, '""')}"`;

    try {
      const rows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT * FROM ${table}
         WHERE ${column} IN ($1, $2)
         LIMIT 20`,
        PAYMENT_REFERENCES[0],
        PAYMENT_REFERENCES[1]
      );

      if (rows.length > 0) {
        paymentMatches.push({
          table: item.table_name,
          column: item.column_name,
          rows,
        });
      }
    } catch (error) {
      console.log(
        `Could not inspect ${item.table_name}.${item.column_name}`
      );
    }
  }

  console.log("\n6. MATCHING PAYMENT RECORDS:");
  console.log(JSON.stringify(paymentMatches, null, 2));

  console.log("\n========== INSPECTION COMPLETE ==========\n");
}

main()
  .catch((error) => {
    console.error("Inspection failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
