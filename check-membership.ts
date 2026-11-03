// @ts-ignore
import { readFile } from "node:fs/promises";
import prisma from "./src/config/prisma.js";

async function main() {
  const sql = await readFile("./check-membership.sql", "utf8");

  const results = await prisma.$queryRawUnsafe(sql);

  console.log("\nMembership records:\n");
  console.table(results);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });