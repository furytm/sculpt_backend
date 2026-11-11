/* eslint-disable @typescript-eslint/no-explicit-any -- services are imported dynamically after DATABASE_URL is set */
/**
 * Offline membership purchase activation and first-class retry against
 * a REAL PostgreSQL database: the acceptance flow, simultaneous admin
 * confirmations, and simultaneous retries. Real Prisma client, row
 * locks and unique keys; Google Calendar is counted, email is answered
 * locally.
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
  process.env.RESEND_API_KEY = "test-key";
  process.env.EMAIL_FROM = "noreply@sculpt.test";
  process.env.JWT_ACCESS_SECRET = "test-access-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
}

vi.mock("../../src/utils/mailer.js", () => ({
  sendPasswordResetEmail: vi.fn(async () => undefined),
  sendVerificationEmail: vi.fn(async () => undefined),
  sendPaymentConfirmationEmail: vi.fn(async () => undefined),
  sendAdminPaymentNotificationEmail: vi.fn(async () => undefined),
}));

const createBookingEvent = vi.fn(async ({ bookingId }: { bookingId: string }) => ({
  eventId: `evt_${bookingId}`,
  eventUrl: `https://calendar.test/${bookingId}`,
}));

vi.mock("../../src/google-calendar/google-calendar.service.js", () => ({
  googleCalendarService: {
    createBookingEvent,
    deleteBookingEvent: vi.fn(async () => undefined),
  },
}));

describe.skipIf(!TEST_DATABASE_URL)("PostgreSQL: offline membership activation", () => {
  let prisma: any;
  let adminService: any;
  let membershipService: any;
  let activationService: any;

  let plan: any;
  let counter = 0;

  const emailFetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => "",
    json: async () => ({ id: "email_1" }),
  }));

  const activationEmails = () =>
    emailFetch.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("api.resend.com")
    ).length;

  beforeAll(async () => {
    vi.stubGlobal("fetch", emailFetch);
    prisma = (await import("../../src/config/prisma.js")).default;
    adminService = (await import("../../src/admin/admin.service.js")).adminService;
    membershipService = (await import("../../src/membership/membership.service.js")).default;
    activationService = (
      await import("../../src/membership-activation/membership-activation.service.js")
    ).membershipActivationService;
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
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
    createBookingEvent.mockClear();
    emailFetch.mockClear();

    plan = await prisma.membership.create({
      data: { name: "Monthly", slug: "monthly", price: 50000, features: [], type: "GROUP", duration: "Monthly", period: "/month", classLimit: 5 },
    });
  });

  /** A class a few days ahead, at 10:00 Lagos. */
  async function addSession() {
    counter += 1;
    const now = new Date();
    const sessionDate = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 3)
    );
    const schedule = await prisma.schedule.create({
      data: {
        className: "Reformer",
        tutorName: "Tutor",
        code: `REF-${Date.now()}-${counter}`,
        dayOfWeek: "MONDAY",
        startTime: "10:00",
        endTime: "11:00",
      },
    });
    return prisma.classSession.create({ data: { scheduleId: schedule.id, sessionDate } });
  }

  async function fillSession(sessionId: string, count: number) {
    const bookings = [];
    for (let index = 0; index < count; index += 1) {
      bookings.push(
        await prisma.booking.create({
          data: {
            fullName: `Other ${index}`,
            email: `other${index}-${counter}@example.com`,
            sessionId,
            membershipId: plan.id,
            amount: 0,
            paymentReference: `OTHER-${sessionId}-${index}`,
            paymentStatus: "PAID",
            bookingStatus: "CONFIRMED",
          },
        })
      );
    }
    return bookings;
  }

  async function offlinePurchase(sessionId: string) {
    counter += 1;
    const result = await membershipService.initiateOfflineMembershipPurchase({
      membershipId: plan.id,
      fullName: "Offline Customer",
      email: `customer${counter}@example.com`,
      phone: "08000000000",
      userId: null,
      firstSessionId: sessionId,
      healthDeclarationAccepted: true,
    });
    return prisma.membershipPurchase.findUnique({ where: { id: result.purchaseId } });
  }

  const membershipFor = (purchaseId: string) =>
    prisma.memberMembership.findUnique({ where: { membershipPurchaseId: purchaseId } });

  const firstBooking = (purchase: any) =>
    prisma.booking.findUnique({
      where: { paymentReference: `${purchase.paymentReference}-FIRST-BOOKING` },
    });

  it("acceptance: class fails, email still sent, customer activates, admin retries, original booking confirms with one credit", async () => {
    const session = await addSession();
    const purchase = await offlinePurchase(session.id);
    const others = await fillSession(session.id, 5);

    const confirmed = await adminService.confirmOfflineMembershipPurchase(purchase.id);
    expect(confirmed.summary).toMatchObject({
      payment: "PAID",
      membershipActivation: "CREATED",
      activationEmail: "SENT",
      firstClass: "NOT_CONFIRMED",
      retryAvailable: true,
    });
    expect(activationEmails()).toBe(1);
    expect(await membershipFor(purchase.id)).toMatchObject({
      creditsUsed: 0,
      startDate: null,
      expiryDate: null,
    });

    const url = new URL(confirmed.activation.activationUrl);
    const activated = await activationService.completeActivation({
      membershipNumber: url.searchParams.get("membership"),
      activationToken: url.searchParams.get("token"),
      password: "CorrectHorse1!",
    });
    expect(activated.user.id).toBe(purchase.userId ?? activated.user.id);

    await prisma.booking.update({
      where: { id: others[0].id },
      data: { bookingStatus: "CANCELLED" },
    });

    const retried = await adminService.retryOfflineMembershipFirstBooking(purchase.id);
    const original = await firstBooking(purchase);

    expect(retried.firstClass).toMatchObject({ status: "CONFIRMED", bookingId: original.id });
    expect(original.bookingStatus).toBe("CONFIRMED");
    expect(await membershipFor(purchase.id)).toMatchObject({
      creditsUsed: 1,
      startDate: session.sessionDate,
    });
    expect(createBookingEvent).toHaveBeenCalledTimes(1);
    expect(await prisma.membershipActivation.count()).toBe(1);
    expect(await prisma.memberMembership.count()).toBe(1);
    expect(activationEmails()).toBe(1);
  });

  it("two admin confirmations at the same moment create one activation and use one credit", async () => {
    for (let round = 0; round < 5; round += 1) {
      createBookingEvent.mockClear();
      emailFetch.mockClear();
      const session = await addSession();
      const purchase = await offlinePurchase(session.id);

      const results = await Promise.allSettled([
        adminService.confirmOfflineMembershipPurchase(purchase.id),
        adminService.confirmOfflineMembershipPurchase(purchase.id),
      ]);

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(
        await prisma.membershipActivation.count({ where: { membershipPurchaseId: purchase.id } })
      ).toBe(1);
      expect((await membershipFor(purchase.id)).creditsUsed).toBe(1);
      expect(createBookingEvent).toHaveBeenCalledTimes(1);
      expect(activationEmails()).toBe(1);
    }
  });

  it("two admin retries at the same moment confirm the first class once", async () => {
    for (let round = 0; round < 3; round += 1) {
      createBookingEvent.mockClear();
      const session = await addSession();
      const purchase = await offlinePurchase(session.id);
      const others = await fillSession(session.id, 5);

      const confirmed = await adminService.confirmOfflineMembershipPurchase(purchase.id);
      expect(confirmed.summary.firstClass).toBe("NOT_CONFIRMED");

      await prisma.booking.update({
        where: { id: others[0].id },
        data: { bookingStatus: "CANCELLED" },
      });

      const results = await Promise.allSettled([
        adminService.retryOfflineMembershipFirstBooking(purchase.id),
        adminService.retryOfflineMembershipFirstBooking(purchase.id),
      ]);
      expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);

      expect((await firstBooking(purchase)).bookingStatus).toBe("CONFIRMED");
      expect((await membershipFor(purchase.id)).creditsUsed).toBe(1);
      expect(createBookingEvent).toHaveBeenCalledTimes(1);
      expect(
        await prisma.booking.count({
          where: { paymentReference: `${purchase.paymentReference}-FIRST-BOOKING` },
        })
      ).toBe(1);
    }
  });
});
