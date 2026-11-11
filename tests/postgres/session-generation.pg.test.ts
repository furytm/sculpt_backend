/* eslint-disable @typescript-eslint/no-explicit-any -- services are imported dynamically after DATABASE_URL is set */
/**
 * Class session generation against a REAL PostgreSQL database: repeated
 * runs (including two at once, as overlapping daily runs would be) never
 * create duplicates, with the real @@unique([scheduleId, sessionDate]).
 *
 * Skipped unless TEST_DATABASE_URL is set; see
 * tests/postgres/membership-concurrency.pg.test.ts for setup. Run the
 * postgres files with --no-file-parallelism, since they share the
 * database (every table is truncated).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

if (TEST_DATABASE_URL) {
  const parsed = new URL(TEST_DATABASE_URL);
  const local = ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
  if (!local || !parsed.pathname.includes("test")) {
    throw new Error(
      "Refusing to run: TEST_DATABASE_URL must be a local database whose name contains \"test\"."
    );
  }
  parsed.searchParams.set("connection_limit", "10");
  process.env.DATABASE_URL = parsed.toString();
}

describe.skipIf(!TEST_DATABASE_URL)("PostgreSQL: class session generation", () => {
  let prisma: any;
  let classSessionService: any;
  let scheduleDailySessionGeneration: any;

  beforeAll(async () => {
    prisma = (await import("../../src/config/prisma.js")).default;
    classSessionService = (await import("../../src/booking/class-session.service.js")).default;
    scheduleDailySessionGeneration = (
      await import("../../src/booking/session-generation.scheduler.js")
    ).scheduleDailySessionGeneration;
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    const tables: { tablename: string }[] = await prisma.$queryRaw`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    `;
    await prisma.$executeRawUnsafe(
      `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`
    );

    for (const [code, dayOfWeek, startTime] of [
      ["MON-07", "MONDAY", "07:00"],
      ["WED-18", "WEDNESDAY", "18:00"],
      ["SAT-10", "SATURDAY", "10:00"],
    ]) {
      await prisma.schedule.create({
        data: { code, className: "Reformer", tutorName: "Tutor", dayOfWeek, startTime, endTime: "19:00" },
      });
    }
  });

  const duplicates = () => prisma.$queryRaw`
    SELECT "scheduleId", "sessionDate", count(*)::int AS n
    FROM "ClassSession"
    GROUP BY "scheduleId", "sessionDate"
    HAVING count(*) > 1
  `;

  it("repeated generation creates no duplicates", async () => {
    const first = await classSessionService.generateFutureSessions();
    const total = await prisma.classSession.count();
    expect(first.sessionsCreated).toBe(total);
    expect(total).toBeGreaterThan(0);

    const second = await classSessionService.generateFutureSessions();
    expect(second).toMatchObject({ sessionsCreated: 0, sessionsExisting: total });
    expect(await prisma.classSession.count()).toBe(total);
    expect(await duplicates()).toEqual([]);
  });

  it("the daily job calls the generator, and overlapping runs are skipped", async () => {
    const warn = vi.fn();
    const job = scheduleDailySessionGeneration(
      () => classSessionService.generateFutureSessions(),
      { logger: { warn, error: vi.fn() } }
    );

    // Two runs requested at once: the second is skipped while the first runs.
    await Promise.all([job.run(), job.run()]);
    job.stop();

    expect(warn).toHaveBeenCalledTimes(1);
    const total = await prisma.classSession.count();
    expect(total).toBeGreaterThan(0);
    expect(await duplicates()).toEqual([]);

    // A later daily run adds nothing that already exists.
    await job.run();
    expect(await prisma.classSession.count()).toBe(total);
  });
});
