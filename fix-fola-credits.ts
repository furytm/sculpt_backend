
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const migrations = await prisma.$queryRaw<
    Array<{
      migration_name: string;
      started_at: Date | null;
      finished_at: Date | null;
      rolled_back_at: Date | null;
      applied_steps_count: number;
    }>
  >`
    SELECT
      migration_name,
      started_at,
      finished_at,
      rolled_back_at,
      applied_steps_count
    FROM "_prisma_migrations"
    ORDER BY started_at ASC;
  `;

  console.log("\nDATABASE MIGRATION HISTORY");
  console.table(migrations);

  console.log(`\nTotal recorded migrations: ${migrations.length}`);
}

main()
  .catch((error) => {
    console.error("Inspection failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
