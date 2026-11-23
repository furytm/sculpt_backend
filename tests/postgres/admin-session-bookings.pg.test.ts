/* eslint-disable @typescript-eslint/no-explicit-any -- services are imported dynamically after DATABASE_URL is set */
/**
 * Admin session bookings and credit removal against a REAL PostgreSQL
 * database (row locks, transactions) through the REAL app. The calendar,
 * mailer and payment provider are stubbed.
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

describe.skipIf(!TEST_DATABASE_URL)("PostgreSQL: admin session bookings and credit removal", () => {
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
      data: { code: `A${count}`, className: "Reformer", tutorName: "Tess", dayOfWeek: "MONDAY", startTime: "10:00", endTime: "11:00", capacity },
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

  const addAttendee = (sessionId: string, n: number) =>
    request(app)
      .post(`/api/admin/sessions/${sessionId}/offline-attendees`)
      .set(as(admin))
      .send({ fullName: `Walk In ${n}`, email: `walk${n}@example.com`, phone: `0803000000${n}`, ratePlanId: groupPlan.id });
  const addMember = (sessionId: string, body: any) =>
    request(app).post(`/api/admin/sessions/${sessionId}/members`).set(as(admin)).send(body);
  const removeCredits = (row: any, body: any) =>
    request(app)
      .post(`/api/admin/members/${row.userId}/memberships/${row.id}/credits/remove`)
      .set(as(admin))
      .send(body);

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

  describe("offline attendee", () => {
    it("concurrent adds for the last two seats: exactly two succeed, never over capacity", async () => {
      const s = await session(2);
      const usersBefore = await prisma.user.count();
      const results = await Promise.all([1, 2, 3, 4].map((n) => addAttendee(s.id, n)));

      expect(results.filter((r) => r.status === 201)).toHaveLength(2);
      expect(results.filter((r) => r.status === 409).every((r) => r.body.code === "SESSION_FULL")).toBe(true);
      expect(await prisma.booking.count({ where: { sessionId: s.id, bookingStatus: "CONFIRMED" } })).toBe(2);
      // No account created for any attendee.
      expect(await prisma.user.count()).toBe(usersBefore);
      expect(await prisma.memberMembership.count()).toBe(0);
    });

    it("concurrent adds of the same person: one booking", async () => {
      const s = await session();
      const results = await Promise.all([1, 2, 3].map(() => addAttendee(s.id, 7)));
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      expect(await prisma.booking.count({ where: { sessionId: s.id } })).toBe(1);
    });

    it("keeps the exact plan selected (bigPlan, not the first GROUP plan) and the amount, with no membership", async () => {
      const s = await session();
      const usersBefore = await prisma.user.count();

      const response = await request(app)
        .post(`/api/admin/sessions/${s.id}/offline-attendees`)
        .set(as(admin))
        .send({ fullName: "Pat Package", email: "pat@example.com", phone: "08030001111", ratePlanId: bigPlan.id, amount: 21000 });

      expect(response.status, JSON.stringify(response.body)).toBe(201);
      const saved = await prisma.booking.findUnique({ where: { id: response.body.data.id }, include: { membership: true } });
      expect(saved).toMatchObject({ membershipId: bigPlan.id, amount: 21000, userId: null, memberMembershipId: null, paymentStatus: "PAID", bookingStatus: "CONFIRMED" });
      expect(saved.membership).toMatchObject({ name: "Group 16", type: "GROUP", price: 25000 });

      const detail = (await request(app).get(`/api/admin/sessions/${s.id}`).set(as(admin))).body.data;
      expect(detail.bookings[0]).toMatchObject({ membershipId: bigPlan.id, amount: 21000, paymentMethod: "OFFLINE" });
      expect(detail.bookings[0].membership).toEqual({ id: bigPlan.id, name: "Group 16", type: "GROUP" });

      expect(await prisma.user.count()).toBe(usersBefore);
      expect(await prisma.memberMembership.count()).toBe(0);
      expect(await prisma.membershipPurchase.count()).toBe(0);
      expect(await prisma.membershipActivation.count()).toBe(0);
    });
  });

  describe("existing member", () => {
    it("USE_CREDIT and the member's own booking at the same moment: one booking, one credit", async () => {
      const s = await session();
      const row = await membership({ creditsUsed: 2 });

      const results = await Promise.all([
        addMember(s.id, { userId: member.id, mode: "USE_CREDIT", bookingType: "GROUP" }),
        request(app)
          .post("/api/bookings/member-session")
          .set(as(member))
          .send({ classSessionId: s.id, bookingType: "GROUP", healthDeclaration: { accepted: true } }),
      ]);

      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(await prisma.booking.count({ where: { sessionId: s.id, userId: member.id, bookingStatus: "CONFIRMED" } })).toBe(1);
      expect((await prisma.memberMembership.findUnique({ where: { id: row.id } })).creditsUsed).toBe(3);
    });

    it("PAID_OFFLINE uses no credit; cancellation restores nothing; USE_CREDIT cancellation restores exactly one", async () => {
      const row = await membership({ creditsUsed: 1 });
      const s1 = await session();
      const s2 = await session(5, 4);

      const offline = await addMember(s1.id, { userId: member.id, mode: "PAID_OFFLINE", ratePlanId: groupPlan.id, amount: 5000 });
      expect(offline.status, JSON.stringify(offline.body)).toBe(201);
      expect(offline.body.data.booking).toMatchObject({ userId: member.id, memberMembershipId: null, amount: 5000, paymentMethod: "OFFLINE" });
      expect((await prisma.memberMembership.findUnique({ where: { id: row.id } })).creditsUsed).toBe(1);

      const credit = await addMember(s2.id, { userId: member.id, mode: "USE_CREDIT", bookingType: "GROUP" });
      expect(credit.body.data).toMatchObject({ creditsDeducted: 1, creditsRemaining: 6 });
      expect((await prisma.memberMembership.findUnique({ where: { id: row.id } })).creditsUsed).toBe(2);

      expect((await request(app).post(`/api/admin/bookings/${offline.body.data.booking.id}/cancel`).set(as(admin))).status).toBe(200);
      expect((await prisma.memberMembership.findUnique({ where: { id: row.id } })).creditsUsed).toBe(2);
      expect((await request(app).post(`/api/admin/bookings/${credit.body.data.booking.id}/cancel`).set(as(admin))).status).toBe(200);
      expect((await prisma.memberMembership.findUnique({ where: { id: row.id } })).creditsUsed).toBe(1);

      // Both appear in the member's history.
      const mine = await request(app).get("/api/bookings/my").set(as(member));
      expect(mine.body.data.bookings.map((b: any) => b.id).sort()).toEqual(
        [offline.body.data.booking.id, credit.body.data.booking.id].sort()
      );
    });
  });

  describe("remove credits", () => {
    it("reduces creditsTotal only, in the database", async () => {
      const row = await membership({ creditsTotal: 10, creditsUsed: 3 });
      const response = await removeCredits(row, { credits: 2, expectedRemaining: 7 });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const saved = await prisma.memberMembership.findUnique({ where: { id: row.id } });
      expect(saved).toMatchObject({ creditsTotal: 8, creditsUsed: 3, startDate: row.startDate, expiryDate: row.expiryDate, status: "ACTIVE" });
    });

    it("concurrent removals never go negative and never remove twice", async () => {
      const row = await membership({ creditsTotal: 5, creditsUsed: 0 });
      const results = await Promise.all([1, 2, 3, 4].map(() => removeCredits(row, { credits: 2, expectedRemaining: 5 })));
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409).every((r) => r.body.code === "STALE_BALANCE")).toBe(true);
      expect((await prisma.memberMembership.findUnique({ where: { id: row.id } })).creditsTotal).toBe(3);
    });

    it("a booking and a removal racing for the last credit: never a negative balance", async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await prisma.booking.deleteMany();
        await prisma.memberMembership.deleteMany();
        const row = await membership({ creditsTotal: 4, creditsUsed: 3 });
        const s = await session();

        const [removal, booking] = await Promise.all([
          removeCredits(row, { credits: 1, expectedRemaining: 1 }),
          request(app)
            .post("/api/bookings/member-session")
            .set(as(member))
            .send({ classSessionId: s.id, bookingType: "GROUP", healthDeclaration: { accepted: true } }),
        ]);

        const saved = await prisma.memberMembership.findUnique({ where: { id: row.id } });
        // Exactly one of them got the credit.
        expect([removal.status, booking.status].filter((status) => status < 300)).toHaveLength(1);
        expect(saved.creditsTotal - saved.creditsUsed).toBe(0);
        expect(saved.creditsUsed).toBeLessThanOrEqual(saved.creditsTotal);
        if (removal.status === 200) expect(saved).toMatchObject({ creditsTotal: 3, creditsUsed: 3 });
        else expect(saved).toMatchObject({ creditsTotal: 4, creditsUsed: 4 });
      }
    });

    it("an upgrade after a removal carries the reduced balance (existing carry-over rule)", async () => {
      const row = await membership({ creditsTotal: 8, creditsUsed: 3 });
      await removeCredits(row, { credits: 2, expectedRemaining: 5 });

      const started = await membershipService.initiateUpgrade(member.id, bigPlan.id);
      expect(started.carriedCredits).toBe(3); // 6 total - 3 used
      expect(started.newCreditsTotal).toBe(16 + 3 + 3);
      await membershipService.completeMembershipPurchase(started.reference);

      const upgraded = await prisma.memberMembership.findFirst({ where: { userId: member.id, status: "ACTIVE" } });
      expect(upgraded).toMatchObject({ membershipId: bigPlan.id, creditsTotal: 22, creditsUsed: 3 });
      expect((await prisma.memberMembership.findUnique({ where: { id: row.id } })).status).toBe("EXPIRED");
    });

    it("records the audit events in the database", async () => {
      const row = await membership({ creditsTotal: 10, creditsUsed: 3 });
      await removeCredits(row, { credits: 2, expectedRemaining: 7 });
      await activityLog.flush();
      const rows = await prisma.memberActivityLog.findMany({ where: { action: { in: ["admin.membership.remove_credits", "credit.admin_removal"] } } });
      expect(rows).toHaveLength(2);
      for (const event of rows) {
        expect(event).toMatchObject({ actorUserId: admin.id, userId: member.id, entityId: row.id });
        expect(event.metadata).toMatchObject({ creditsRemoved: 2, previousCreditsRemaining: 7, creditsRemaining: 5 });
      }
    });
  });
});
