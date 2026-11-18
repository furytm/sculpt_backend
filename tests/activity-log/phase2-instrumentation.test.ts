/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed fake rows and HTTP bodies */
/**
 * Phase 2 instrumentation over HTTP against the real app (real routes,
 * middleware, controllers and services; Prisma is the in-memory fake;
 * Paymish/mailer/calendar are stubbed).
 *
 * Each test checks BOTH that the business outcome is unchanged
 * (responses, bookings, credits) and which events were recorded.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createFakePrisma } from "../helpers/fake-prisma";

process.env.JWT_ACCESS_SECRET = "test-access-secret";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
process.env.RESEND_API_KEY = "re_test_dummy";
process.env.FRONTEND_URL = "https://site.test";
process.env.PAYMISH_BASE_URL = "https://paymish.test";
process.env.PAYMISH_SECRET_KEY = "sk_test_secret";

const fake = createFakePrisma();
vi.mock("../../src/config/prisma.js", () => ({ default: fake.prisma }));

vi.mock("axios", () => {
  const isAxiosError = (error: any) => Boolean(error?.isAxiosError);
  return {
    default: {
      post: vi.fn(),
      get: vi.fn(async (url: string) => {
        const reference = decodeURIComponent(url.split("/").pop() ?? "");
        return { data: { status: "success", data: { status: "completed", reference } } };
      }),
      isAxiosError,
    },
    isAxiosError,
  };
});

vi.mock("../../src/utils/mailer.js", () => ({
  sendPasswordResetEmail: vi.fn(async () => undefined),
  sendVerificationEmail: vi.fn(async () => undefined),
  sendPaymentConfirmationEmail: vi.fn(async () => undefined),
  sendAdminPaymentNotificationEmail: vi.fn(async () => undefined),
  sendEmailChangeCodeEmail: vi.fn(async () => undefined),
  sendEmailChangedNoticeEmail: vi.fn(async () => undefined),
}));

const calendar = vi.hoisted(() => ({
  createBookingEvent: null as any,
  deleteBookingEvent: null as any,
}));
vi.mock("../../src/google-calendar/google-calendar.service.js", () => ({
  googleCalendarService: {
    createBookingEvent: (...args: any[]) => calendar.createBookingEvent(...args),
    deleteBookingEvent: (...args: any[]) => calendar.deleteBookingEvent(...args),
  },
}));

vi.mock("../../src/admin/admin-notification.service.js", () => ({
  AdminNotificationServiceError: class extends Error {},
  adminNotificationService: { createForAllAdmins: vi.fn(async () => undefined) },
}));

let app: any;
let activityLog: any;
let tokenFor: (user: { id: string; email: string; role: string }) => string;

const MEMBER = { id: "member_1", email: "mina@example.com", role: "MEMBER" };
const OTHER = { id: "member_2", email: "otto@example.com", role: "MEMBER" };
const ADMIN = { id: "admin_1", email: "admin@example.com", role: "ADMIN" };

beforeAll(async () => {
  for (const method of ["log", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation(() => undefined);
  }
  app = (await import("../../src/app.js")).default;
  activityLog = (await import("../../src/activity-log/activity-log.service.js")).activityLog;
  const { generateAccessToken } = await import("../../src/utils/jwt.js");
  tokenFor = (user) => generateAccessToken({ userId: user.id, email: user.email, role: user.role } as any);
}, 60_000);

const as = (user: { id: string; email: string; role: string }) => ({ Authorization: `Bearer ${tokenFor(user)}` });

let plan: any;
let session: any;
let membership: any;

/** A class 3 days from now at 10:00 Lagos (09:00 UTC). */
function addSession() {
  const date = new Date(Date.now() + 3 * 86_400_000);
  date.setUTCHours(9, 0, 0, 0);
  const schedule = fake.insert("schedule", {
    className: "Reformer",
    tutorName: "Tutor",
    code: `REF-${fake.tables.schedule.length + 1}`,
    dayOfWeek: "TUESDAY",
    startTime: "10:00",
    endTime: "11:00",
    capacity: 5,
    isActive: true,
  });
  return fake.insert("classSession", { scheduleId: schedule.id, sessionDate: date, capacity: null, status: "OPEN" });
}

beforeEach(() => {
  fake.reset();
  calendar.createBookingEvent = vi.fn(async () => ({ eventId: null, eventUrl: null }));
  calendar.deleteBookingEvent = vi.fn(async () => undefined);

  for (const user of [MEMBER, OTHER, ADMIN]) {
    fake.insert("user", { ...user, fullName: user.id, phone: "08000000000", provider: "LOCAL", password: null });
  }
  plan = fake.insert("membership", {
    name: "Monthly 8", slug: "monthly-8", type: "GROUP", price: 50000, period: "/month",
    classLimit: 8, duration: "Monthly", isActive: true, features: [],
  });
  session = addSession();
  membership = fake.insert("memberMembership", {
    userId: MEMBER.id,
    membershipId: plan.id,
    status: "ACTIVE",
    startDate: new Date(Date.now() - 5 * 86_400_000),
    expiryDate: new Date(Date.now() + 25 * 86_400_000),
    creditsTotal: 8,
    creditsUsed: 2,
  });
});

const logs = () =>
  [...fake.tables.memberActivityLog].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
const events = () => logs().map((row) => `${row.action} ${row.stage}`);
const settle = async () => {
  // Credit events read the balance after the operation, asynchronously.
  await new Promise((resolve) => setTimeout(resolve, 20));
  await activityLog.flush();
};

const bookSession = (user = MEMBER, body: Record<string, unknown> = {}) =>
  request(app)
    .post("/api/bookings/member-session")
    .set(as(user))
    .send({ classSessionId: session.id, bookingType: "GROUP", healthDeclaration: { accepted: true }, ...body });

// ---------------------------------------------------------------------

describe("member booking with a credit", () => {
  it("success: unchanged response and credit use; INITIATED, booking SUCCEEDED and credit.deduction", async () => {
    const response = await bookSession();
    await settle();

    expect(response.status).toBe(201);
    expect(response.body.message).toBe("Class session booked successfully.");
    const booking = response.body.data.booking;
    expect(booking).toMatchObject({ bookingStatus: "CONFIRMED", memberMembershipId: membership.id });
    // Exactly one credit used, as before.
    expect(fake.get("memberMembership", membership.id).creditsUsed).toBe(3);
    expect(calendar.createBookingEvent).toHaveBeenCalledTimes(1);

    expect(events()).toEqual(["booking INITIATED", "booking SUCCEEDED", "credit.deduction SUCCEEDED"]);
    const [initiated, succeeded, credit] = logs();
    expect(initiated).toMatchObject({ userId: MEMBER.id, actorType: "MEMBER", entityType: "CLASS_SESSION", entityId: session.id });
    expect(succeeded).toMatchObject({
      userId: MEMBER.id,
      entityType: "BOOKING",
      entityId: booking.id,
      paymentReference: booking.paymentReference,
      correlationId: booking.paymentReference,
    });
    expect(credit).toMatchObject({
      userId: MEMBER.id,
      entityType: "MEMBER_MEMBERSHIP",
      entityId: membership.id,
      correlationId: booking.paymentReference,
      metadata: expect.objectContaining({
        bookingId: booking.id,
        creditsDeducted: 1,
        creditsTotal: 8,
        creditsUsed: 3,
        creditsRemaining: 5,
      }),
    });
    // One request: every event carries its request ID.
    for (const row of logs()) expect(row.requestId).toBe(response.headers["x-request-id"]);
  });

  it("validation failure: unchanged 400; VALIDATION_FAILED recorded; no credit used", async () => {
    const response = await bookSession(MEMBER, { bookingType: "SOMETHING" });
    await settle();

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ success: false, message: "Booking type must be GROUP or PRIVATE." });
    expect(events()).toEqual(["booking VALIDATION_FAILED"]);
    expect(logs()[0]).toMatchObject({ errorCode: "VALIDATION_ERROR", metadata: { missingFields: "bookingType" } });
    expect(fake.get("memberMembership", membership.id).creditsUsed).toBe(2);
  });

  it("business failure (no credits left): unchanged 400; booking FAILED; nothing deducted", async () => {
    fake.get("memberMembership", membership.id).creditsUsed = 8;

    const response = await bookSession();
    await settle();

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/remaining .*credits/);
    expect(fake.tables.booking).toHaveLength(0);
    expect(events()).toEqual(["booking INITIATED", "booking FAILED"]);
    expect(logs()[1]).toMatchObject({ status: "FAILURE", httpStatus: 400, errorCode: "REQUEST_REJECTED" });
    expect(fake.get("memberMembership", membership.id).creditsUsed).toBe(8);
  });

  it("a failing activity log changes nothing: same response, one credit used", async () => {
    const realCreate = fake.prisma.memberActivityLog.create.getMockImplementation();
    fake.prisma.memberActivityLog.create.mockImplementation(async () => {
      throw new Error("table missing");
    });

    try {
      const response = await bookSession();
      await settle();

      expect(response.status).toBe(201);
      expect(fake.get("memberMembership", membership.id).creditsUsed).toBe(3);
      expect(fake.tables.booking).toHaveLength(1);
      expect(logs()).toHaveLength(0);
    } finally {
      // Restore the fake's real implementation for the following tests.
      fake.prisma.memberActivityLog.create.mockImplementation(realCreate!);
    }
  });

  it("record() itself throwing changes nothing either", async () => {
    const spy = vi.spyOn(activityLog, "record").mockImplementation(() => {
      throw new Error("logger exploded");
    });
    const response = await bookSession();
    spy.mockRestore();

    expect(response.status).toBe(201);
    expect(fake.get("memberMembership", membership.id).creditsUsed).toBe(3);
  });
});

describe("cancellation", () => {
  it("member cancel: credit restored as before; INITIATED, SUCCEEDED, credit.restoration, one operation", async () => {
    const booked = await bookSession();
    const booking = booked.body.data.booking;
    await settle();

    const response = await request(app).post(`/api/bookings/${booking.id}/cancel`).set(as(MEMBER));
    await settle();

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, message: "Booking cancelled successfully.", creditRestored: true });
    expect(fake.get("booking", booking.id).bookingStatus).toBe("CANCELLED");
    expect(fake.get("memberMembership", membership.id).creditsUsed).toBe(2);

    expect(events().slice(3)).toEqual([
      "booking.cancellation INITIATED",
      "booking.cancellation SUCCEEDED",
      "credit.restoration SUCCEEDED",
    ]);
    const restoration = logs().at(-1);
    expect(restoration).toMatchObject({
      actorType: "MEMBER",
      userId: MEMBER.id,
      metadata: expect.objectContaining({ creditsRestored: 1, creditsUsed: 2, creditsRemaining: 6 }),
    });
    // Booking and cancellation share the booking's reference as the operation.
    const operation = logs().filter((row) => row.correlationId === booking.paymentReference).map((row) => row.action);
    expect(operation).toEqual(expect.arrayContaining(["booking", "booking.cancellation", "credit.deduction", "credit.restoration"]));
  });

  it("another member cannot cancel: unchanged 400; FAILED recorded; nothing restored", async () => {
    const booked = await bookSession();
    const booking = booked.body.data.booking;

    const response = await request(app).post(`/api/bookings/${booking.id}/cancel`).set(as(OTHER));
    await settle();

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("You are not authorized to cancel this booking.");
    expect(fake.get("booking", booking.id).bookingStatus).toBe("CONFIRMED");
    expect(fake.get("memberMembership", membership.id).creditsUsed).toBe(3);
    expect(logs().at(-1)).toMatchObject({ action: "booking.cancellation", stage: "FAILED", userId: OTHER.id, entityId: booking.id });
  });

  it("admin cancel: admin is the actor, the member the subject; credit restored as before", async () => {
    const booked = await bookSession();
    const booking = booked.body.data.booking;
    await settle();

    const response = await request(app).post(`/api/admin/bookings/${booking.id}/cancel`).set(as(ADMIN));
    await settle();

    expect(response.status).toBe(200);
    expect(fake.get("booking", booking.id).bookingStatus).toBe("CANCELLED");
    expect(fake.get("memberMembership", membership.id).creditsUsed).toBe(2);

    const adminEvents = logs().filter((row) => row.actorType === "ADMIN");
    expect(adminEvents.map((row) => `${row.action} ${row.stage}`)).toEqual([
      "booking.cancellation INITIATED",
      "booking.cancellation SUCCEEDED",
      "credit.restoration SUCCEEDED",
    ]);
    for (const row of adminEvents) {
      expect(row.actorUserId).toBe(ADMIN.id);
      expect(row.userId).toBe(MEMBER.id);
    }
  });
});

describe("membership first booking (confirmation through the payment callback)", () => {
  it("confirmation and credit deduction are recorded once, even when the callback repeats", async () => {
    fake.tables.memberMembership.length = 0; // no existing membership
    const purchase = fake.insert("membershipPurchase", {
      userId: MEMBER.id,
      email: MEMBER.email,
      fullName: "Mina",
      phone: "08000000000",
      membershipId: plan.id,
      type: "NEW",
      paymentMethod: "PAYMISH",
      paymentStatus: "PENDING",
      paymentReference: "SL-FIRST-1",
      amount: 50000,
      firstSessionId: session.id,
      healthDeclarationAccepted: true,
    });

    const first = await request(app).get("/api/payments/callback?reference=SL-FIRST-1");
    const repeat = await request(app).get("/api/payments/callback?reference=SL-FIRST-1");
    await settle();

    expect(first.status).toBe(302);
    expect(first.headers.location).toContain("status=success");
    expect(repeat.headers.location).toBe(first.headers.location);

    const confirmed = fake.tables.booking.filter((row) => row.bookingStatus === "CONFIRMED");
    expect(confirmed).toHaveLength(1);
    const newMembership = fake.tables.memberMembership.find((row) => row.membershipPurchaseId === purchase.id);
    expect(newMembership.creditsUsed).toBe(1);

    const count = (label: string) => events().filter((value) => value === label).length;
    expect(count("booking.confirmation SUCCEEDED")).toBe(1);
    expect(count("credit.deduction SUCCEEDED")).toBe(1);
    expect(count("membership.purchase_completion SUCCEEDED")).toBe(1);

    const completion = logs().find((row) => row.action === "membership.purchase_completion");
    expect(completion.metadata).toMatchObject({ purchaseType: "NEW" });
    const confirmation = logs().find((row) => row.action === "booking.confirmation");
    expect(confirmation).toMatchObject({ userId: MEMBER.id, entityId: confirmed[0].id });
  });
});

describe("admin actions", () => {
  it("assigning a membership: admin actor (never from the body), member subject, credits recorded", async () => {
    const response = await request(app)
      .post(`/api/admin/members/${MEMBER.id}/memberships`)
      .set(as(ADMIN))
      .send({ membershipId: plan.id, totalCredits: 10, usedCredits: 3, actorUserId: "spoofed", userId: "spoofed" });
    await settle();

    expect(response.status).toBe(201);
    const created = response.body.data;
    expect(created).toMatchObject({ creditsTotal: 10, creditsUsed: 3 });

    expect(events()).toEqual(["admin.membership.assign SUCCEEDED", "credit.admin_assignment SUCCEEDED"]);
    for (const row of logs()) {
      expect(row).toMatchObject({ actorType: "ADMIN", actorUserId: ADMIN.id, userId: MEMBER.id });
    }
    expect(logs()[1]).toMatchObject({
      entityType: "MEMBER_MEMBERSHIP",
      entityId: created.id,
      metadata: expect.objectContaining({ creditsAssigned: 7, creditsTotal: 10, creditsUsed: 3, creditsRemaining: 7 }),
    });
  });

  it("a failing admin action is recorded with its status and a safe message", async () => {
    const response = await request(app)
      .post(`/api/admin/members/${MEMBER.id}/memberships`)
      .set(as(ADMIN))
      .send({ membershipId: "no-such-plan" });
    await settle();

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(logs()).toEqual([
      expect.objectContaining({
        action: "admin.membership.assign",
        stage: "FAILED",
        actorUserId: ADMIN.id,
        userId: MEMBER.id,
        httpStatus: response.status,
      }),
    ]);
  });

  it("admin routes still reject members (the audit adds no access)", async () => {
    const response = await request(app)
      .post(`/api/admin/members/${MEMBER.id}/memberships`)
      .set(as(MEMBER))
      .send({ membershipId: plan.id });
    await settle();

    expect(response.status).toBe(403);
    expect(logs()).toHaveLength(0);
  });
});

describe("public endpoints", () => {
  it("activation verify failures are capped (one event a minute)", async () => {
    for (let i = 0; i < 3; i += 1) {
      await request(app).post("/api/membership-activation/verify").send({ membershipNumber: `X-${i}`, token: "bad" });
    }
    await settle();

    expect(logs()).toHaveLength(1);
    expect(logs()[0]).toMatchObject({ action: "membership.activation", stage: "FAILED", actorType: "GUEST" });
  });

  it("errors no route handles are recorded (no stack), capped per route", async () => {
    for (let i = 0; i < 2; i += 1) {
      await request(app).post("/api/memberships/upgrade").set("Content-Type", "application/json").send("{bad json");
    }
    await settle();

    expect(logs()).toEqual([
      expect.objectContaining({
        action: "system.unhandled_error",
        status: "FAILURE",
        errorCode: "INVALID_JSON",
        httpStatus: 400,
      }),
    ]);
    expect(JSON.stringify(logs()[0])).not.toMatch(/\bat \S+ \(/);
  });
});
