
import prisma from "./src/config/prisma.js";


async function main() {
  console.log("Checking MembershipActivation.bookingId...");

  await prisma.$executeRaw`
    ALTER TABLE "MembershipActivation"
    ALTER COLUMN "bookingId" DROP NOT NULL
  `;

  const result = await prisma.$queryRaw<
    { column_name: string; is_nullable: string }[]
  >`
    SELECT column_name, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'MembershipActivation'
      AND column_name = 'bookingId'
  `;

  console.log("Neon column check:", result);

  if (result[0]?.is_nullable !== "YES") {
    throw new Error("bookingId is still NOT NULL in the database.");
  }

  console.log("SUCCESS: Neon now allows membership-only activations.");
}

main()
  .catch((error) => {
    console.error("Database fix failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });