/**
 * Activity-log retention: removes old events. NOT scheduled and never
 * run by an API request. Call it explicitly (see the CLI below); it is a
 * dry run unless `dryRun: false` is passed.
 *
 * Two windows:
 * - SUCCESS / INFO / WARNING events: `retentionDays` (default 180);
 * - FAILURE events: `failureRetentionDays` (default 365), kept longer
 *   for investigations.
 *
 * Deletes in batches (by id, oldest first) so it never holds long locks.
 */
import { Prisma } from "@prisma/client";
import prisma from "../config/prisma.js";
import { logger } from "../observability/logger.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetentionOptions {
  retentionDays?: number;
  failureRetentionDays?: number;
  /** Default true: only count what would be deleted. */
  dryRun?: boolean;
  batchSize?: number;
  /** Safety cap on batches per run. */
  maxBatches?: number;
  now?: Date;
}

export interface RetentionResult {
  dryRun: boolean;
  cutoff: string;
  failureCutoff: string;
  /** Rows matching the retention rules. */
  matched: number;
  /** Rows actually deleted (0 on a dry run). */
  deleted: number;
  /** True when maxBatches stopped the run before everything was deleted. */
  incomplete: boolean;
}

function days(value: number | undefined, fallback: number, name: string) {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < 30) {
    throw new Error(`${name} must be a whole number of days, at least 30.`);
  }
  return result;
}

export function retentionWhere(cutoff: Date, failureCutoff: Date): Prisma.MemberActivityLogWhereInput {
  return {
    OR: [
      { status: { not: "FAILURE" }, createdAt: { lt: cutoff } },
      { status: "FAILURE", createdAt: { lt: failureCutoff } },
    ],
  };
}

export async function purgeActivityLogs(options: RetentionOptions = {}): Promise<RetentionResult> {
  const retentionDays = days(
    options.retentionDays ?? (Number(process.env.ACTIVITY_LOG_RETENTION_DAYS) || undefined),
    180,
    "retentionDays"
  );
  const failureRetentionDays = days(
    options.failureRetentionDays ?? (Number(process.env.ACTIVITY_LOG_FAILURE_RETENTION_DAYS) || undefined),
    365,
    "failureRetentionDays"
  );
  if (failureRetentionDays < retentionDays) {
    throw new Error("failureRetentionDays must not be shorter than retentionDays.");
  }

  const dryRun = options.dryRun !== false;
  const batchSize = Math.min(Math.max(options.batchSize ?? 1000, 1), 5000);
  const maxBatches = Math.max(options.maxBatches ?? 1000, 1);
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
  const failureCutoff = new Date(now.getTime() - failureRetentionDays * DAY_MS);
  const where = retentionWhere(cutoff, failureCutoff);

  const matched = await prisma.memberActivityLog.count({ where });
  let deleted = 0;
  let incomplete = false;

  if (!dryRun) {
    for (let batch = 0; ; batch += 1) {
      if (batch >= maxBatches) {
        incomplete = true;
        break;
      }
      const ids = await prisma.memberActivityLog.findMany({
        where,
        select: { id: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: batchSize,
      });
      if (!ids.length) break;
      const result = await prisma.memberActivityLog.deleteMany({
        where: { id: { in: ids.map((row) => row.id) } },
      });
      deleted += result.count;
      if (ids.length < batchSize) break;
    }
  }

  const result: RetentionResult = {
    dryRun,
    cutoff: cutoff.toISOString(),
    failureCutoff: failureCutoff.toISOString(),
    matched,
    deleted,
    incomplete,
  };

  logger.info("activity_log.retention", { ...result, retentionDays, failureRetentionDays });
  return result;
}
