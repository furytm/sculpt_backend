/* eslint-disable @typescript-eslint/no-explicit-any -- services are imported dynamically after DATABASE_URL is set */
/**
 * Pooled credit removal against a REAL PostgreSQL database (row locks,
 * transactions, rollback) through the REAL app:
 *   POST /api/admin/members/:memberId/credit-pools/:type/credits/remove
 *
 * Skipped unless TEST_DATABASE_URL is set; see
 * tests/postgres/membership-concurrency.pg.test.ts for setup. Run the
 * postgres files with --no-file-parallelism.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

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
  process.env.JWT_ACCESS_SECRET = "test-access-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  process.env.RESEND_API_KEY = "re_test_dummy";
  process.env.FRONTEND_URL = "http://localhost:3000";
}

vi.mock("../../src/google-calendar/google-calendar.service.js", () => ({
  googleCalendarService: { createBookingEvent: vi.fn(async () => ({ eventId: null, eventUrl: null })) },
}));
vi.mock("../../src/payment/payment.service.js", () => ({
  default: {
    initializeTransaction: vi.fn(async ({ reference }: { reference: string }) => ({
      status: true,
      data: { authorization_url: `https://pay.test/${reference}`, reference },
    })),
  },
}));
vi.mock("../../src/utils/mailer.js", () => ({
  sendPasswordResetEmail: vi.fn(async () => undefined),
  sendVerificationEmail: vi.fn(async () => undefined),
  sendPaymentConfirmationEmail: vi.fn(async () => undefined),
  sendAdminPaymentNotificationEmail: vi.fn(async () => undefined),
  sendEmailChangeCodeEmail: vi.fn(async () => undefined),
  sendEmailChangedNoticeEmail: vi.fn(async () => undefined),
}));

const DAY = 86_400_000;

describe.skipIf(!TEST_DATABASE_URL)("PostgreSQL: pooled credit removal", () => {
  let prisma: any;
  let app: any;
  let activityLog: any;
  let membershipService: any;
  let token: (user: any) => string;
  let admin: any;
  let member: any;
  let groupPlan: any;
  let bigPlan: any;

  const truncateAll = async () => {
    const tables: { tablename: string }[] = await prisma.$queryRaw`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    `;
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  };

  const as = (user: any) => ({ Authorization: `Bearer ${token(user)}` });
  const utcDay = (offset: number) => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + offset * DAY);
  };

  let count = 0;
  async function session(capacity = 5, days = 3) {
    count += 1;
    const schedule = await prisma.schedule.create({
      data: { code: `P${count}`, className: "Reformer", tutorName: "Tess", dayOfWeek: "MONDAY", startTime: "10:00", endTime: "11:00", capacity },
    });
    return prisma.classSession.create({ data: { scheduleId: schedule.id, sessionDate: utcDay(days) } });
  }

  const membership = (overrides: any = {}) =>
    prisma.memberMembership.create({
      data: {
        userId: member.id,
        membershipId: groupPlan.id,
        status: "ACTIVE",
        startDate: utcDay(-5),
        expiryDate: utcDay(25),
        creditsTotal: 8,
        creditsUsed: 0,
        ...overrides,
      },
    });

  const removePool = (body: any, type = "GROUP") =>
    request(app)
      .post(`/api/admin/members/${member.id}/credit-pools/${type}/credits/remove`)
      .set(as(admin))
      .send(body);
  const removeOne = (row: any, body: any) =>
    request(app)
      .post(`/api/admin/members/${row.userId}/memberships/${row.id}/credits/remove`)
      .set(as(admin))
      .send(body);
  const reload = (row: any) => prisma.memberMembership.findUnique({ where: { id: row.id } });
  const remaining = (row: any) => Math.max(row.creditsTotal - row.creditsUsed, 0);

  // The worked example: 3 left on the current membership, 5 on the renewal.
  const twoRecords = async () => {
    const original = await membership({ creditsTotal: 5, creditsUsed: 2, startDate: utcDay(-20), expiryDate: utcDay(10) });
    const renewal = await membership({ creditsTotal: 5, creditsUsed: 0, startDate: utcDay(10), expiryDate: utcDay(40) });
    return { original, renewal };
  };

  beforeAll(async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    prisma = (await import("../../src/config/prisma.js")).default;
    app = (await import("../../src/app.js")).default;
    activityLog = (await import("../../src/activity-log/activity-log.service.js")).activityLog;
    membershipService = (await import("../../src/membership/membership.service.js")).default;
    const { generateAccessToken } = await import("../../src/utils/jwt.js");
    token = (user) => generateAccessToken({ userId: user.id, email: user.email, role: user.role });
  }, 60_000);

  beforeEach(async () => {
    await activityLog.flush();
    await truncateAll();
    const user = (email: string, role: string, fullName: string) =>
      prisma.user.create({ data: { email, role, fullName, phone: "0800", password: "$2a$10$hashhashhash" } });
    admin = await user("admin@example.com", "ADMIN", "Ada Admin");
    member = await user("mina@example.com", "MEMBER", "Mina Member");
    groupPlan = await prisma.membership.create({
      data: { name: "Group 8", slug: "group-8", type: "GROUP", price: 15000, period: "/month", classLimit: 8, duration: "Monthly", features: [] },
    });
    bigPlan = await prisma.membership.create({
      data: { name: "Group 16", slug: "group-16", type: "GROUP", price: 25000, period: "/2 months", classLimit: 16, duration: "2 Months", features: [] },
    });
  });

  afterAll(async () => {
    if (prisma) {
      await activityLog.flush();
      await truncateAll();
      await prisma.$disconnect();
    }
  });

  it("spreads the removal across records in the database, changing creditsTotal only", async () => {
    const { original, renewal } = await twoRecords();

    const response = await removePool({ credits: 4, expectedRemaining: 8 });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.data.updated.poolRemaining).toBe(4);
    expect(await reload(original)).toMatchObject({ creditsTotal: 2, creditsUsed: 2, status: "ACTIVE", startDate: original.startDate, expiryDate: original.expiryDate });
    expect(await reload(renewal)).toMatchObject({ creditsTotal: 4, creditsUsed: 0, status: "ACTIVE", startDate: renewal.startDate, expiryDate: renewal.expiryDate });
  });

  it("concurrent pooled removals: exactly one succeeds, never removed twice", async () => {
    const { original, renewal } = await twoRecords();

    const results = await Promise.all([1, 2, 3, 4].map(() => removePool({ credits: 3, expectedRemaining: 8 })));

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status !== 200).every((r) => r.status === 409 && r.body.code === "STALE_BALANCE")).toBe(true);
    const rows = [await reload(original), await reload(renewal)];
    expect(rows.reduce((total, row) => total + remaining(row), 0)).toBe(5);
    for (const row of rows) expect(row.creditsTotal).toBeGreaterThanOrEqual(row.creditsUsed);
  });

  it("a pooled and a single-record removal racing: exactly one succeeds", async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await prisma.memberMembership.deleteMany();
      const { original, renewal } = await twoRecords();

      const [pooled, single] = await Promise.all([
        removePool({ credits: 4, expectedRemaining: 8 }),
        removeOne(renewal, { credits: 1, expectedRemaining: 5 }),
      ]);

      expect([pooled.status, single.status].filter((status) => status === 200)).toHaveLength(1);
      const total = remaining(await reload(original)) + remaining(await reload(renewal));
      expect(total).toBe(pooled.status === 200 ? 4 : 7);
    }
  });

  it("a booking racing a pooled removal for the last credits: never a negative balance", async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await prisma.booking.deleteMany();
      await prisma.memberMembership.deleteMany();
      const first = await membership({ creditsTotal: 4, creditsUsed: 3, expiryDate: utcDay(10) });
      const second = await membership({ creditsTotal: 3, creditsUsed: 2, expiryDate: utcDay(40) });
      const s = await session();

      const [removal, booking] = await Promise.all([
        removePool({ credits: 2, expectedRemaining: 2 }),
        request(app)
          .post("/api/bookings/member-session")
          .set(as(member))
          .send({ classSessionId: s.id, bookingType: "GROUP", healthDeclaration: { accepted: true } }),
      ]);

      const rows = [await reload(first), await reload(second)];
      for (const row of rows) expect(row.creditsUsed).toBeLessThanOrEqual(row.creditsTotal);
      expect([removal.status, booking.status].filter((status) => status < 300)).toHaveLength(1);
      const left = rows.reduce((total, row) => total + remaining(row), 0);
      if (removal.status === 200) {
        // Both credits removed; the booking found none.
        expect(left).toBe(0);
        expect(await prisma.booking.count({ where: { bookingStatus: "CONFIRMED" } })).toBe(0);
      } else {
        // The booking used one; the removal saw a changed balance.
        expect(removal.body.code).toBe("STALE_BALANCE");
        expect(left).toBe(1);
      }
    }
  });

  it("an upgrade completing while a pooled removal runs: credits are carried or removed, never both", async () => {
    const row = await membership({ creditsTotal: 8, creditsUsed: 3 });
    const started = await membershipService.initiateUpgrade(member.id, bigPlan.id);

    const [removal] = await Promise.all([
      removePool({ credits: 2, expectedRemaining: 5 }),
      membershipService.completeMembershipPurchase(started.reference),
    ]);

    const upgraded = await prisma.memberMembership.findFirst({ where: { userId: member.id, status: "ACTIVE" } });
    expect((await reload(row)).status).toBe("EXPIRED");
    if (removal.status === 200) {
      // Removed first: the upgrade carried 3 (16 + 3 carried + 3 used).
      expect(upgraded).toMatchObject({ membershipId: bigPlan.id, creditsTotal: 22, creditsUsed: 3 });
    } else {
      // Upgraded first: the pool changed, so nothing was removed.
      expect(removal.body.code).toBe("STALE_BALANCE");
      expect(upgraded).toMatchObject({ membershipId: bigPlan.id, creditsTotal: 24, creditsUsed: 3 });
    }
  });

  it("rolls back every record when a later record's update fails", async () => {
    const { original, renewal } = await twoRecords();
    // Test database only: make the second record's update fail.
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION pool_test_fail_update() RETURNS trigger AS $$
      BEGIN
        IF OLD.id = '${renewal.id}' THEN RAISE EXCEPTION 'pool test: forced failure'; END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER pool_test_fail_update BEFORE UPDATE ON "MemberMembership" FOR EACH ROW EXECUTE FUNCTION pool_test_fail_update()`
    );

    try {
      const response = await removePool({ credits: 4, expectedRemaining: 8 });
      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS pool_test_fail_update ON "MemberMembership"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS pool_test_fail_update()`);
    }

    // The first record's change was rolled back with it.
    expect(await reload(original)).toMatchObject({ creditsTotal: 5, creditsUsed: 2 });
    expect(await reload(renewal)).toMatchObject({ creditsTotal: 5, creditsUsed: 0 });
    await activityLog.flush();
    expect(await prisma.memberActivityLog.count({ where: { action: "credit.admin_removal" } })).toBe(0);
  });

  it("the admin members list's pool balance is the expectedRemaining preview and removal accept", async () => {
    await twoRecords(); // 3 + 5
    await membership({ creditsTotal: 3, creditsUsed: 5 }); // over-used: counts 0
    await membership({ expiryDate: utcDay(-1) }); // expired: excluded
    await membership({ status: "EXPIRED" }); // inactive: excluded

    const list = await request(app).get("/api/admin/members").set(as(admin));
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const pool = list.body.data.members.find((item: any) => item.id === member.id).creditPools.GROUP;
    expect(pool.creditsRemaining).toBe(8);
    expect(pool.membershipIds).toHaveLength(3);

    const body = { credits: 4, expectedRemaining: pool.creditsRemaining };
    const preview = await request(app)
      .post(`/api/admin/members/${member.id}/credit-pools/GROUP/credits/preview`)
      .set(as(admin))
      .send(body);
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    const removed = await removePool(body);
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    expect(removed.body.data).toEqual(preview.body.data);
  });

  it("a first-class confirmation racing a credit removal never restores the removed credits", async () => {
    const bookingService = (await import("../../src/booking/booking.service.js")).default;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await prisma.booking.deleteMany();
      await prisma.memberMembership.deleteMany();
      await prisma.membershipPurchase.deleteMany();
      const s = await session();
      const purchase = await prisma.membershipPurchase.create({
        data: {
          userId: member.id,
          email: member.email,
          fullName: "Mina Member",
          phone: "0800",
          membershipId: groupPlan.id,
          type: "NEW",
          amount: 15000,
          paymentReference: `SL-RACE-${attempt}-${Date.now()}`,
          paymentStatus: "PAID",
          firstSessionId: s.id,
          healthDeclarationAccepted: true,
        },
      });
      // The purchase's membership: ACTIVE, full allowance, first class not booked yet.
      const row = await membership({ membershipPurchaseId: purchase.id, startDate: s.sessionDate, expiryDate: utcDay(33) });

      const [removal, firstClass] = await Promise.allSettled([
        removeOne(row, { credits: 2, expectedRemaining: 8 }),
        bookingService.createMembershipFirstBooking({
          purchaseReference: purchase.paymentReference,
          userId: member.id,
          membershipId: groupPlan.id,
          firstSessionId: s.id,
          fullName: "Mina Member",
          email: member.email,
          phone: "0800",
        }),
      ]);

      expect(firstClass.status, String((firstClass as any).reason)).toBe("fulfilled");
      const saved = await reload(row);
      expect(saved.creditsUsed).toBe(1);
      const removed = removal.status === "fulfilled" && removal.value.status === 200;
      if (removed) {
        // The removal won the lock: its 2 credits stay removed after the first class.
        expect(saved.creditsTotal).toBe(6);
      } else {
        // The first class won: the removal saw a changed balance and did nothing.
        expect(removal.status === "fulfilled" && removal.value.body.code).toBe("STALE_BALANCE");
        expect(saved.creditsTotal).toBe(8);
      }
    }
  });

  it("records the pool event and one event per affected record in the database", async () => {
    const { original, renewal } = await twoRecords();
    await removePool({ credits: 4, expectedRemaining: 8 });
    await activityLog.flush();

    const summary = await prisma.memberActivityLog.findFirst({ where: { action: "admin.membership.remove_pool_credits", status: "SUCCESS" } });
    expect(summary).toMatchObject({ actorUserId: admin.id, userId: member.id, entityType: "USER", entityId: member.id });
    expect(summary.metadata).toMatchObject({ membershipType: "GROUP", creditsRemoved: 4, previousPoolRemaining: 8, poolRemaining: 4, recordsAffected: 2 });

    const perRecord = await prisma.memberActivityLog.findMany({ where: { action: "credit.admin_removal" } });
    const byId = Object.fromEntries(perRecord.map((event: any) => [event.entityId, event]));
    expect(Object.keys(byId).sort()).toEqual([original.id, renewal.id].sort());
    expect(byId[original.id].metadata).toMatchObject({ source: "credit_pool", creditsRemoved: 3, previousCreditsTotal: 5, creditsTotal: 2, creditsRemaining: 0 });
    expect(byId[renewal.id].metadata).toMatchObject({ source: "credit_pool", creditsRemoved: 1, previousCreditsTotal: 5, creditsTotal: 4, creditsRemaining: 4 });
    expect(new Set([summary, ...perRecord].map((event: any) => event.correlationId)).size).toBe(1);
  });
});
