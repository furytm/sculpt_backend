
// const { Client } = require("pg");

// async function main() {
//   const client = new Client({
// connectionString: "postgresql://neondb_owner:npg_u2Se7vnrOJdE@ep-orange-fire-b2khkb19.c-6.eu-central-1.aws.neon.tech/neondb?sslmode=require",
//     ssl: { rejectUnauthorized: false },
//   });

//   try {
//     await client.connect();

//     const result = await client.query(`
//       SELECT
//         mp."id" AS "purchaseId",
//         mp."userId",
//         mp."membershipId",
//         mp."paymentStatus",
//         mp."createdAt" AS "purchaseDate",
//         mm."id" AS "membershipRecordId",
//         mm."status" AS "membershipStatus",
//         mm."creditsTotal",
//         mm."creditsUsed",
//         mm."expiryDate"
//       FROM "MembershipPurchase" mp
//       LEFT JOIN "MemberMembership" mm
//         ON mm."userId" = mp."userId"
//         AND mm."membershipId" = mp."membershipId"
//       ORDER BY mp."createdAt" DESC
//       LIMIT 10;
//     `);

//     console.table(result.rows);
//   } finally {
//     await client.end();
//   }
// }

// main().catch(console.error);