/**
 * Manual CLI for activity-log retention. Not scheduled anywhere.
 *
 *   npx tsx src/activity-log/run-activity-log-retention.ts            (dry run)
 *   npx tsx src/activity-log/run-activity-log-retention.ts --apply    (deletes)
 *
 * Options: --days=180 --failure-days=365
 * It uses DATABASE_URL: check which database that is before --apply.
 */
import "dotenv/config";
import prisma from "../config/prisma.js";
import { purgeActivityLogs } from "./activity-log.retention.js";
const arg = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.split("=")[1];
async function main() {
    const result = await purgeActivityLogs({
        dryRun: !process.argv.includes("--apply"),
        retentionDays: arg("days") ? Number(arg("days")) : undefined,
        failureRetentionDays: arg("failure-days") ? Number(arg("failure-days")) : undefined,
    });
    console.log(JSON.stringify(result, null, 2));
}
main()
    .catch((error) => {
    console.error("Activity-log retention failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
})
    .finally(() => prisma.$disconnect());
//# sourceMappingURL=run-activity-log-retention.js.map