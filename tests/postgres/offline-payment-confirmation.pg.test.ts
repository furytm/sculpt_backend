/* eslint-disable @typescript-eslint/no-explicit-any -- services are imported dynamically after DATABASE_URL is set */
/**
 * Admin offline payment confirmation against a REAL PostgreSQL database:
 * simultaneous confirmations, and an admin retry racing the customer's
 * own confirmation. Real Prisma client, row locks and unique keys;
 * Google Calendar is counted, email is answered locally.
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

describe.skipIf(!TEST_DATABASE_URL)("PostgreSQL: offline payment confirmation", () => {
  let prisma: any;
  let adminService: any;
  let bookingService: any;
  let activationService: any;

  let plan: any;
  let counter = 0;

  const emailFetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => "",
    json: async () => ({ id: "email_1" }),
  }));

  beforeAll(async () => {
    vi.stubGlobal("fetch", emailFetch);
    prisma = (await import("../../src/config/prisma.js")).default;
    adminService = (await import("../../src/admin/admin.service.js")).adminService;
    bookingService = (await import("../../src/booking/booking.service.js")).default;
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

    for (const email of ["admin1@example.com", "admin2@example.com"]) {
      await prisma.user.create({ data: { fullName: "Admin", email, role: "ADMIN" } });
    }

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

  async function checkout(sessionId: string) {
    counter += 1;
    const result = await bookingService.createBooking({
      fullName: "Offline Customer",
      email: `customer${counter}@example.com`,
      phone: "08000000000",
      membershipId: plan.id,
      classId: "Reformer",
      classSessionId: sessionId,
      healthDeclaration: { accepted: true },
      paymentMethod: "OFFLINE",
    });
    return result.booking;
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

  const membershipFor = async (bookingId: string) => {
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    return booking.memberMembershipId
      ? prisma.memberMembership.findUnique({ where: { id: booking.memberMembershipId } })
      : null;
  };

  it("two admin confirmations at the same time: one membership, one credit, one calendar event", async () => {
    for (let round = 0; round < 5; round += 1) {
      createBookingEvent.mockClear();
      const session = await addSession();
      const booking = await checkout(session.id);

      const results = await Promise.allSettled([
        adminService.confirmOfflinePayment(booking.id),
        adminService.confirmOfflinePayment(booking.id),
      ]);

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);

      const after = await prisma.booking.findUnique({ where: { id: booking.id } });
      expect(after.bookingStatus).toBe("CONFIRMED");
      expect(await prisma.membershipActivation.count({ where: { bookingId: booking.id } })).toBe(1);

      const membership = await membershipFor(booking.id);
      expect(membership.creditsUsed).toBe(1);
      expect(membership.startDate).toEqual(session.sessionDate);
      expect(createBookingEvent).toHaveBeenCalledTimes(1);
    }

    // One membership per confirmed payment, none extra.
    expect(await prisma.memberMembership.count()).toBe(5);
  });

  it("an admin retry racing the customer's own confirmation books the class once", async () => {
    for (let round = 0; round < 3; round += 1) {
      createBookingEvent.mockClear();
      const session = await addSession();
      const booking = await checkout(session.id);
      const others = await fillSession(session.id, 5);

      const first = await adminService.confirmOfflinePayment(booking.id);
      expect(first.classBooking.status).toBe("NOT_CONFIRMED");

      // The customer activates their account.
      const url = new URL(first.activationUrl);
      const activated = await activationService.completeActivation({
        membershipNumber: url.searchParams.get("membership"),
        activationToken: url.searchParams.get("token"),
        password: "CorrectHorse1!",
      });

      // A place opens; admin and customer both confirm at once.
      await prisma.booking.update({
        where: { id: others[0].id },
        data: { bookingStatus: "CANCELLED" },
      });

      const results = await Promise.allSettled([
        adminService.confirmOfflinePayment(booking.id),
        bookingService.confirmBooking(booking.id, activated.user.id),
      ]);
      expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);

      const membership = await membershipFor(booking.id);
      expect(membership.creditsUsed).toBe(1);
      expect(createBookingEvent).toHaveBeenCalledTimes(1);
      expect(
        (await prisma.booking.findUnique({ where: { id: booking.id } })).bookingStatus
      ).toBe("CONFIRMED");
    }
  });

  it("repeated failures notify each admin once", async () => {
    const session = await addSession();
    const booking = await checkout(session.id);
    await fillSession(session.id, 5);

    await adminService.confirmOfflinePayment(booking.id);
    await Promise.all([
      adminService.confirmOfflinePayment(booking.id),
      adminService.confirmOfflinePayment(booking.id),
    ]);

    expect(
      await prisma.adminNotification.count({
        where: { eventKey: `offline-class-not-confirmed:${booking.id}` },
      })
    ).toBe(2);
    expect(await prisma.membershipActivation.count({ where: { bookingId: booking.id } })).toBe(1);
    expect((await membershipFor(booking.id)).creditsUsed).toBe(0);
  });
});
