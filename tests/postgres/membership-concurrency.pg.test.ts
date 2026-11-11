/* eslint-disable @typescript-eslint/no-explicit-any -- services are imported dynamically after DATABASE_URL is set */
/**
 * Concurrency tests against a REAL PostgreSQL database.
 *
 * These use the real Prisma client and real row locks; nothing about
 * the database is simulated. Only the payment provider and Google
 * Calendar are stubbed.
 *
 * Skipped unless TEST_DATABASE_URL is set. The URL must point at a
 * local database whose name contains "test", because every table is
 * truncated before each test. Prepare one with:
 *
 *   initdb -D <dir> -U postgres -A trust
 *   pg_ctl -D <dir> -o "-p 54329 -c listen_addresses=127.0.0.1" start
 *   createdb -h 127.0.0.1 -p 54329 -U postgres sculpt_test
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:54329/sculpt_test \
 *     npx prisma db push --skip-generate
 *
 * Run (one file at a time: every file truncates the same database):
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:54329/sculpt_test \
 *     npx vitest run tests/postgres --no-file-parallelism
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import pg from "pg";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

function assertSafeTestDatabase(url: string) {
  const parsed = new URL(url);
  const local = ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
  const name = parsed.pathname.replace(/^\//, "");
  if (!local || !name.includes("test")) {
    throw new Error(
      `Refusing to run: TEST_DATABASE_URL must be a local database whose name contains "test" (got ${parsed.hostname}/${name}).`
    );
  }
}

if (TEST_DATABASE_URL) {
  assertSafeTestDatabase(TEST_DATABASE_URL);
  // The services create their Prisma client on import, from DATABASE_URL.
  const url = new URL(TEST_DATABASE_URL);
  url.searchParams.set("connection_limit", "10");
  process.env.DATABASE_URL = url.toString();
}

vi.mock("../../src/payment/payment.service.js", () => ({
  default: {
    initializeTransaction: vi.fn(async ({ reference }: { reference: string }) => ({
      status: true,
      data: { authorization_url: `https://pay.test/${reference}`, reference },
    })),
  },
}));

vi.mock("../../src/google-calendar/google-calendar.service.js", () => ({
  googleCalendarService: {
    createBookingEvent: vi.fn(async () => ({ eventId: null, eventUrl: null })),
  },
}));

const DAY = 24 * 60 * 60 * 1000;

/** UTC midnight, `days` from today. */
function utcDay(days: number) {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + days * DAY
  );
}

function addMonths(date: Date, months: number) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

describe.skipIf(!TEST_DATABASE_URL)("PostgreSQL concurrency", () => {
  let prisma: any;
  let membershipService: any;
  let bookingService: any;
  let lockClient: pg.Client;

  let plans: Record<string, any>;
  let userId: string;
  let referenceCounter = 0;

  beforeAll(async () => {
    prisma = (await import("../../src/config/prisma.js")).default;
    membershipService = (await import("../../src/membership/membership.service.js")).default;
    bookingService = (await import("../../src/booking/booking.service.js")).default;

    lockClient = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await lockClient.connect();
  });

  afterAll(async () => {
    await lockClient?.end();
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

    const user = await prisma.user.create({
      data: { fullName: "Test Member", email: "member@example.com", phone: "08000000000" },
    });
    userId = user.id;

    const plan = (slug: string, data: Record<string, unknown>) =>
      prisma.membership.create({
        data: { name: slug, slug, price: 50000, features: [], type: "GROUP", ...data },
      });

    plans = {
      monthly: await plan("monthly", { duration: "Monthly", period: "/month", classLimit: 8 }),
      twoMonth: await plan("two-month", { duration: "2 Months", period: "/2 months", classLimit: 16 }),
      quarterly: await plan("quarterly", { duration: "Quarterly", period: "3 months", classLimit: 24 }),
    };
  });

  // -------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------

  /** A running monthly membership with 5 of 8 credits left. */
  async function addRunningMembership(overrides: Record<string, unknown> = {}) {
    // Day-of-month <= 28, so month arithmetic never overflows.
    const expiry = utcDay(20);
    if (expiry.getUTCDate() > 28) expiry.setUTCDate(28);

    return prisma.memberMembership.create({
      data: {
        userId,
        membershipId: plans.monthly.id,
        status: "ACTIVE",
        startDate: utcDay(-10),
        expiryDate: expiry,
        creditsTotal: 8,
        creditsUsed: 3,
        ...overrides,
      },
    });
  }

  async function addPendingPurchase(
    type: "UPGRADE" | "RENEWAL",
    membershipId: string,
    previousMemberMembershipId: string | null
  ) {
    referenceCounter += 1;
    return prisma.membershipPurchase.create({
      data: {
        userId,
        email: "member@example.com",
        membershipId,
        type,
        amount: 50000,
        paymentReference: `SL-PG-${type}-${Date.now()}-${referenceCounter}`,
        paymentStatus: "PENDING",
        previousMemberMembershipId,
      },
    });
  }

  let scheduleCounter = 0;

  async function addSession(sessionDate: Date) {
    scheduleCounter += 1;
    const schedule = await prisma.schedule.create({
      data: {
        className: "Reformer",
        tutorName: "Tutor",
        code: `REF-${Date.now()}-${scheduleCounter}`,
        dayOfWeek: "MONDAY",
        startTime: "10:00",
        endTime: "11:00",
      },
    });
    return prisma.classSession.create({
      data: { scheduleId: schedule.id, sessionDate },
    });
  }

  const book = (sessionId: string) =>
    bookingService.bookMemberSession(userId, sessionId, { accepted: true }, "GROUP");

  const complete = (reference: string) =>
    membershipService.completeMembershipPurchase(reference);

  const activeRows = () =>
    prisma.memberMembership.findMany({ where: { userId, status: "ACTIVE" } });

  const remaining = (row: { creditsTotal: number | null; creditsUsed: number }) =>
    (row.creditsTotal ?? 0) - row.creditsUsed;

  /** Wait until `count` sessions are blocked on a lock in this database. */
  async function waitForLockWaiters(count: number) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const result = await lockClient.query(
        `SELECT count(*)::int AS waiting FROM pg_stat_activity
         WHERE datname = current_database() AND wait_event_type = 'Lock'`
      );
      if (result.rows[0].waiting >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out waiting for ${count} lock waiter(s).`);
  }

  function track<T>(promise: Promise<T>) {
    const state = { settled: false };
    const tracked = promise.finally(() => {
      state.settled = true;
    });
    return { state, promise: tracked };
  }

  // -------------------------------------------------------------------
  // Upgrades
  // -------------------------------------------------------------------

  it("two upgrades completing at once: credits carried once, one ACTIVE row, validity chained", async () => {
    for (let round = 0; round < 5; round += 1) {
      if (round > 0) {
        await prisma.memberMembership.deleteMany({});
        await prisma.membershipPurchase.deleteMany({});
      }

      const current = await addRunningMembership();
      const first = await addPendingPurchase("UPGRADE", plans.twoMonth.id, current.id);
      const second = await addPendingPurchase("UPGRADE", plans.quarterly.id, current.id);

      const results = await Promise.allSettled([
        complete(first.paymentReference),
        complete(second.paymentReference),
      ]);
      expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);

      // Applied one after the other: 5 unused credits carried once,
      // plus 16 and 24 new; 3 used kept.
      const active = await activeRows();
      expect(active).toHaveLength(1);
      expect(remaining(active[0])).toBe(5 + 16 + 24);
      expect(active[0].creditsUsed).toBe(3);

      // Remaining time kept, both durations added once.
      expect(active[0].expiryDate).toEqual(addMonths(current.expiryDate, 5));
      expect(active[0].startDate).toEqual(current.startDate);

      const all = await prisma.memberMembership.findMany({ where: { userId } });
      expect(all.filter((row: any) => row.status === "EXPIRED")).toHaveLength(2);
    }
  });

  it("an upgrade waits while the member is locked, then uses the committed state", async () => {
    const current = await addRunningMembership();
    const upgrade = await addPendingPurchase("UPGRADE", plans.twoMonth.id, current.id);

    await lockClient.query("BEGIN");
    await lockClient.query(`SELECT id FROM "User" WHERE id = $1 FOR UPDATE`, [userId]);

    const completion = track(complete(upgrade.paymentReference));
    await waitForLockWaiters(1);
    expect(completion.state.settled).toBe(false);

    // Another change commits first: one more credit used.
    await lockClient.query(
      `UPDATE "MemberMembership" SET "creditsUsed" = 4 WHERE id = $1`,
      [current.id]
    );
    await lockClient.query("COMMIT");

    await completion.promise;

    const [upgraded] = await activeRows();
    // Carries 4 unused (not the stale 5) and keeps 4 used.
    expect(upgraded.creditsTotal).toBe(16 + 4 + 4);
    expect(upgraded.creditsUsed).toBe(4);
  });

  it("the same upgrade completed twice at once (webhook + callback) applies once", async () => {
    const current = await addRunningMembership();
    const upgrade = await addPendingPurchase("UPGRADE", plans.twoMonth.id, current.id);

    const results = await Promise.allSettled([
      complete(upgrade.paymentReference),
      complete(upgrade.paymentReference),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);

    const forPurchase = await prisma.memberMembership.findMany({
      where: { membershipPurchaseId: upgrade.id },
    });
    expect(forPurchase).toHaveLength(1);

    const active = await activeRows();
    expect(active).toHaveLength(1);
    expect(active[0].creditsTotal).toBe(16 + 5 + 3);
  });

  it("a booking and an upgrade at the same time do not use a credit twice", async () => {
    for (let round = 0; round < 5; round += 1) {
      if (round > 0) {
        await prisma.booking.deleteMany({});
        await prisma.memberMembership.deleteMany({});
        await prisma.membershipPurchase.deleteMany({});
      }

      const current = await addRunningMembership();
      const upgrade = await addPendingPurchase("UPGRADE", plans.twoMonth.id, current.id);
      const session = await addSession(utcDay(3));

      const results = await Promise.allSettled([
        book(session.id),
        complete(upgrade.paymentReference),
      ]);
      expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);

      // Whichever runs first: 5 unused + 16 new - 1 booked.
      const active = await activeRows();
      expect(active).toHaveLength(1);
      expect(remaining(active[0])).toBe(5 + 16 - 1);
    }
  });

  it("a FAILED (superseded) upgrade cannot complete", async () => {
    const current = await addRunningMembership();
    const upgrade = await addPendingPurchase("UPGRADE", plans.twoMonth.id, current.id);
    await prisma.membershipPurchase.update({
      where: { id: upgrade.id },
      data: { paymentStatus: "FAILED" },
    });

    await expect(complete(upgrade.paymentReference)).rejects.toThrow(
      "cancelled or replaced by a newer purchase"
    );

    const active = await activeRows();
    expect(active.map((row: any) => row.id)).toEqual([current.id]);
    expect(
      await prisma.memberMembership.count({ where: { membershipPurchaseId: upgrade.id } })
    ).toBe(0);
  });

  it("a newer upgrade attempt does not mark an upgrade that is completing as FAILED", async () => {
    const current = await addRunningMembership();
    const completing = await addPendingPurchase("UPGRADE", plans.twoMonth.id, current.id);

    // Hold the member so the completion stops after locking its purchase.
    await lockClient.query("BEGIN");
    await lockClient.query(`SELECT id FROM "User" WHERE id = $1 FOR UPDATE`, [userId]);

    const completion = track(complete(completing.paymentReference));
    await waitForLockWaiters(1);

    // The newer attempt's "mark older PENDING upgrades FAILED" update
    // has to wait for that purchase row.
    const newer = track(membershipService.initiateUpgrade(userId, plans.quarterly.id));
    await waitForLockWaiters(2);
    expect(newer.state.settled).toBe(false);

    await lockClient.query("COMMIT");
    await completion.promise;
    const newerResult: any = await newer.promise;

    const completed = await prisma.membershipPurchase.findUnique({
      where: { id: completing.id },
    });
    expect(completed.paymentStatus).toBe("PAID");

    const newerPurchase = await prisma.membershipPurchase.findUnique({
      where: { paymentReference: newerResult.reference },
    });
    expect(newerPurchase.paymentStatus).toBe("PENDING");

    const active = await activeRows();
    expect(active).toHaveLength(1);
    expect(active[0].membershipId).toBe(plans.twoMonth.id);
  });

  // -------------------------------------------------------------------
  // Renewals and bookings
  // -------------------------------------------------------------------

  it("two renewals completing at once are queued one after the other", async () => {
    for (let round = 0; round < 5; round += 1) {
      if (round > 0) {
        await prisma.memberMembership.deleteMany({});
        await prisma.membershipPurchase.deleteMany({});
      }

      const current = await addRunningMembership();
      const first = await addPendingPurchase("RENEWAL", plans.monthly.id, null);
      const second = await addPendingPurchase("RENEWAL", plans.monthly.id, null);

      const results = await Promise.allSettled([
        complete(first.paymentReference),
        complete(second.paymentReference),
      ]);
      expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);

      const renewals = await prisma.memberMembership.findMany({
        where: { userId, membershipPurchaseId: { in: [first.id, second.id] } },
        orderBy: { startDate: "asc" },
      });

      expect(renewals.map((row: any) => [row.startDate, row.expiryDate])).toEqual([
        [current.expiryDate, addMonths(current.expiryDate, 1)],
        [addMonths(current.expiryDate, 1), addMonths(current.expiryDate, 2)],
      ]);
    }
  });

  it("two bookings for the last credit at once: exactly one succeeds", async () => {
    for (let round = 0; round < 5; round += 1) {
      if (round > 0) {
        await prisma.booking.deleteMany({});
        await prisma.memberMembership.deleteMany({});
      }

      const current = await addRunningMembership({ creditsUsed: 7 }); // 1 left
      const [first, second] = [await addSession(utcDay(3)), await addSession(utcDay(4))];

      const results = await Promise.allSettled([book(first.id), book(second.id)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);

      const after = await prisma.memberMembership.findUnique({ where: { id: current.id } });
      expect(after.creditsUsed).toBe(8);
      expect(
        await prisma.booking.count({ where: { userId, bookingStatus: "CONFIRMED" } })
      ).toBe(1);
    }
  });

  it("two first bookings at once start an awaiting membership exactly once", async () => {
    const purchase = await prisma.membershipPurchase.create({
      data: {
        userId,
        email: "member@example.com",
        membershipId: plans.monthly.id,
        type: "NEW",
        amount: 50000,
        paymentReference: `SL-PG-NEW-${Date.now()}`,
        paymentStatus: "PAID",
      },
    });
    const awaiting = await prisma.memberMembership.create({
      data: {
        userId,
        membershipId: plans.monthly.id,
        membershipPurchaseId: purchase.id,
        status: "ACTIVE",
        creditsTotal: 8,
      },
    });
    const sessions = [await addSession(utcDay(3)), await addSession(utcDay(5))];

    const results = await Promise.allSettled(sessions.map((s) => book(s.id)));
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    expect(succeeded).toBeGreaterThanOrEqual(1);

    const after = await prisma.memberMembership.findUnique({ where: { id: awaiting.id } });
    // Started on one of the two session dates, exactly once.
    expect(sessions.map((s) => s.sessionDate.getTime())).toContain(
      after.startDate.getTime()
    );
    expect(after.expiryDate).toEqual(addMonths(after.startDate, 1));
    expect(after.creditsUsed).toBe(succeeded);
  });
});
