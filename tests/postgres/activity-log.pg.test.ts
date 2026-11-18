/* eslint-disable @typescript-eslint/no-explicit-any -- services are imported dynamically after DATABASE_URL is set */
/**
 * MemberActivityLog against a REAL PostgreSQL database and the real
 * migration: events survive a rolled-back business transaction,
 * concurrent duplicates store one row, and deleting a member keeps the
 * history (userId set to null).
 *
 * Skipped unless TEST_DATABASE_URL is set; see
 * tests/postgres/membership-concurrency.pg.test.ts for setup. Run the
 * postgres files with --no-file-parallelism.
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

describe.skipIf(!TEST_DATABASE_URL)("PostgreSQL: activity log", () => {
  let prisma: any;
  let activityLog: any;
  let user: any;

  const truncateAll = async () => {
    const tables: { tablename: string }[] = await prisma.$queryRaw`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    `;
    await prisma.$executeRawUnsafe(
      `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`
    );
  };

  beforeAll(async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    prisma = (await import("../../src/config/prisma.js")).default;
    activityLog = (await import("../../src/activity-log/activity-log.service.js")).activityLog;
  });

  beforeEach(async () => {
    await truncateAll();
    user = await prisma.user.create({ data: { fullName: "Lee Member", email: "lee@example.com", role: "MEMBER" } });
  });

  afterAll(async () => {
    if (prisma) {
      await truncateAll();
      await prisma.$disconnect();
    }
  });

  it("a failure event recorded inside a transaction survives its rollback", async () => {
    const membership = await prisma.membership.create({
      data: { name: "Monthly", slug: "monthly", price: 50000, features: [], type: "GROUP", duration: "Monthly", period: "/month", classLimit: 8 },
    });

    await expect(
      prisma.$transaction(async (tx: any) => {
        await tx.membershipPurchase.create({
          data: { userId: user.id, email: user.email, membershipId: membership.id, type: "NEW", amount: 1, paymentReference: "SL-RB-1" },
        });
        activityLog.record({
          action: "membership.purchase",
          stage: "FAILED",
          status: "FAILURE",
          userId: user.id,
          errorCode: "BOOM",
        });
        // Give the log write time to commit while the transaction is open.
        await new Promise((resolve) => setTimeout(resolve, 200));
        throw new Error("business failure");
      })
    ).rejects.toThrow("business failure");

    await activityLog.flush();

    expect(await prisma.membershipPurchase.count()).toBe(0); // rolled back
    const rows = await prisma.memberActivityLog.findMany();
    expect(rows).toEqual([expect.objectContaining({ userId: user.id, stage: "FAILED", errorCode: "BOOM" })]);
  });

  it("concurrent duplicates with one dedupeKey store exactly one row", async () => {
    for (let i = 0; i < 10; i += 1) {
      activityLog.record({
        action: "membership.purchase_completion",
        stage: "SUCCEEDED",
        status: "SUCCESS",
        userId: user.id,
        dedupeKey: "membership.purchase_completion:SL-DUP-1",
      });
    }
    await activityLog.flush();

    expect(await prisma.memberActivityLog.count()).toBe(1);
  });

  it("real Prisma duplicate-key errors are recognized: duplicates are ignored without any warning", async () => {
    const { resetActivityLogWarningLimiterForTests } = await import("../../src/activity-log/activity-log.service.js");
    resetActivityLogWarningLimiterForTests();
    const warn = vi.mocked(console.warn);
    warn.mockClear();

    for (let i = 0; i < 5; i += 1) {
      activityLog.record({
        action: "payment.callback",
        stage: "VERIFIED",
        status: "SUCCESS",
        userId: user.id,
        dedupeKey: "payment.callback.verified:SL-REAL-DUP",
      });
      await activityLog.flush(); // sequential: each later write hits the unique index
    }

    expect(await prisma.memberActivityLog.count()).toBe(1);
    const writeFailures = warn.mock.calls.filter((call) => String(call[0]).includes("activity_log.write_failed"));
    expect(writeFailures).toHaveLength(0);
  });

  it("deleting the member keeps their history, with userId set to null", async () => {
    activityLog.record({ action: "membership.upgrade", stage: "INITIATED", status: "INFO", userId: user.id });
    await activityLog.flush();

    await prisma.user.delete({ where: { id: user.id } });

    const rows = await prisma.memberActivityLog.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: null, action: "membership.upgrade" });
  });

  it("uses the indexes the migration created", async () => {
    const indexes: { indexname: string }[] = await prisma.$queryRaw`
      SELECT indexname FROM pg_indexes WHERE tablename = 'MemberActivityLog' ORDER BY indexname
    `;
    expect(indexes.map((row) => row.indexname)).toEqual([
      "MemberActivityLog_action_createdAt_idx",
      "MemberActivityLog_correlationId_idx",
      "MemberActivityLog_createdAt_idx",
      "MemberActivityLog_dedupeKey_key",
      "MemberActivityLog_entityType_entityId_idx",
      "MemberActivityLog_paymentReference_idx",
      "MemberActivityLog_pkey",
      "MemberActivityLog_status_createdAt_idx",
      "MemberActivityLog_userId_createdAt_idx",
    ]);
  });
});
