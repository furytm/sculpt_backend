/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed results and mock call arguments */
/**
 * Admin confirmation of an offline (bank transfer) payment, in memory
 * (Prisma replaced by tests/helpers/fake-prisma).
 *
 * Real code throughout: the public checkout (createBooking with
 * OFFLINE), AdminService.confirmOfflinePayment, the normal booking
 * confirmation it reuses, the activation link and member bookings.
 * Stubbed: Google Calendar (counted), the activation email transport
 * (counted, no network), admin notifications (counted) and the mailer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePrisma, type Row } from "../helpers/fake-prisma";
import { addMonths } from "../helpers/seeded-plans";

const fake = createFakePrisma();

vi.mock("../../src/config/prisma.js", () => ({ default: fake.prisma }));

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

const createForAllAdmins = vi.fn(async () => ({ created: 1, pushSent: 0 }));

vi.mock("../../src/admin/admin-notification.service.js", () => ({
  adminNotificationService: { createForAllAdmins },
}));

const { adminService } = await import("../../src/admin/admin.service.js");
const { default: bookingService } = await import(
  "../../src/booking/booking.service.js"
);
const { membershipActivationService } = await import(
  "../../src/membership-activation/membership-activation.service.js"
);

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------

const EMAIL = "customer@example.com";
const CHECKOUT_TIME = new Date("2026-10-24T09:00:00.000Z");
const CLASS_DATE = new Date("2026-11-03T00:00:00.000Z"); // 10:00 Lagos

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

function addPlan(data: Row) {
  return fake.insert("membership", {
    name: `${data.duration} ${data.type}`,
    slug: `plan-${fake.tables.membership.length + 1}`,
    price: 50000,
    isActive: true,
    features: [],
    ...data,
  });
}

const groupMonthly = () =>
  addPlan({ type: "GROUP", duration: "Monthly", period: "/month", classLimit: 5 });

const privatePackage = () =>
  addPlan({ type: "PRIVATE", duration: "Package", period: "package", classLimit: 5 });

function addSession(sessionDate: Date) {
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

  return fake.insert("classSession", {
    scheduleId: schedule.id,
    sessionDate,
    status: "OPEN",
  });
}

function fillSession(session: Row, plan: Row, count: number) {
  return Array.from({ length: count }, (_, index) =>
    fake.insert("booking", {
      fullName: `Other ${index}`,
      email: `other${index}@example.com`,
      userId: `other_${index}`,
      sessionId: session.id,
      membershipId: plan.id,
      amount: 0,
      paymentReference: `OTHER-${session.id}-${index}`,
      paymentStatus: "PAID",
      bookingStatus: "CONFIRMED",
    })
  );
}

/** The public checkout with "pay by transfer". */
async function offlineCheckout(
  plan: Row,
  options: { session?: Row; healthDeclaration?: boolean } = {}
) {
  const result = await bookingService.createBooking({
    fullName: "Offline Customer",
    email: EMAIL,
    phone: "08000000000",
    membershipId: plan.id,
    classId: options.session ? "Reformer" : undefined,
    classSessionId: options.session?.id,
    healthDeclaration:
      options.healthDeclaration === false ? undefined : { accepted: true },
    paymentMethod: "OFFLINE",
  });
  return result.booking as Row;
}

const booking = (id: string) => fake.get("booking", id);

const membershipFor = (bookingId: string) => {
  const id = booking(bookingId).memberMembershipId;
  return id ? fake.get("memberMembership", id) : null;
};

const memberships = () => fake.tables.memberMembership;
const activations = () => fake.tables.membershipActivation;

/** The customer follows the activation link and sets a password. */
async function activate(activationUrl: string) {
  const url = new URL(activationUrl);
  const result = await membershipActivationService.completeActivation({
    membershipNumber: url.searchParams.get("membership")!,
    activationToken: url.searchParams.get("token")!,
    password: "CorrectHorse1!",
  } as any);
  return result.user.id as string;
}

beforeEach(() => {
  fake.reset();
  createBookingEvent.mockClear();
  createForAllAdmins.mockClear();
  emailFetch.mockClear();

  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(CHECKOUT_TIME);

  process.env.RESEND_API_KEY = "test-key";
  process.env.EMAIL_FROM = "noreply@sculpt.test";
  process.env.JWT_ACCESS_SECRET = "test-access-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  vi.stubGlobal("fetch", emailFetch);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
});

// ---------------------------------------------------------------------
// 1. No class selected
// ---------------------------------------------------------------------

describe("offline payment without a selected class", () => {
  it("confirms the payment and leaves the membership waiting for its first booked class", async () => {
    const plan = groupMonthly();
    const checkout = await offlineCheckout(plan);

    const result: any = await adminService.confirmOfflinePayment(checkout.id);

    expect(result.classBooking).toBeUndefined();
    expect(booking(checkout.id)).toMatchObject({
      paymentStatus: "PAID",
      bookingStatus: "CONFIRMED",
    });

    const membership = membershipFor(checkout.id)!;
    expect(membership).toMatchObject({
      startDate: null,
      expiryDate: null,
      creditsTotal: 5,
      creditsUsed: 0,
    });
    expect(createBookingEvent).not.toHaveBeenCalled();
    expect(activationEmails()).toBe(1);

    // The customer activates, then books their first class.
    const userId = await activate(result.activationUrl);
    const session = addSession(CLASS_DATE);
    await bookingService.bookMemberSession(userId, session.id, { accepted: true }, "GROUP");

    const after = fake.get("memberMembership", membership.id);
    expect(after.creditsUsed).toBe(1);
    expect(after.startDate).toEqual(CLASS_DATE);
    expect(after.expiryDate).toEqual(addMonths(CLASS_DATE, 1));
  });
});

// ---------------------------------------------------------------------
// 2, 3, 9. Selected class, confirmed
// ---------------------------------------------------------------------

describe("offline payment with a selected class", () => {
  it("books the class through the normal confirmation, using exactly one credit", async () => {
    const plan = groupMonthly();
    const session = addSession(CLASS_DATE);
    const checkout = await offlineCheckout(plan, { session });

    const result: any = await adminService.confirmOfflinePayment(checkout.id);

    expect(result.paymentConfirmed).toBe(true);
    expect(result.classBooking).toMatchObject({
      status: "CONFIRMED",
      bookingId: checkout.id,
      sessionId: session.id,
    });

    expect(booking(checkout.id)).toMatchObject({
      paymentStatus: "PAID",
      bookingStatus: "CONFIRMED",
      sessionId: session.id,
      calendarEventId: `evt_${checkout.id}`,
    });

    // Exactly one credit, from the new membership; validity starts on
    // the class date.
    const membership = membershipFor(checkout.id)!;
    expect(memberships()).toHaveLength(1);
    expect(membership.creditsTotal).toBe(5);
    expect(membership.creditsUsed).toBe(1);
    expect(membership.startDate).toEqual(CLASS_DATE);
    expect(membership.expiryDate).toEqual(addMonths(CLASS_DATE, 1));

    expect(createBookingEvent).toHaveBeenCalledTimes(1);
    expect(activationEmails()).toBe(1);
    expect(createForAllAdmins).not.toHaveBeenCalled();
  });

  it("the customer's next class uses the next credit, and the first isn't charged again", async () => {
    const plan = groupMonthly();
    const session = addSession(CLASS_DATE);
    const checkout = await offlineCheckout(plan, { session });
    const result: any = await adminService.confirmOfflinePayment(checkout.id);

    const userId = await activate(result.activationUrl);

    // Confirming the first class again as the customer changes nothing.
    await bookingService.confirmBooking(checkout.id, userId);
    expect(membershipFor(checkout.id)!.creditsUsed).toBe(1);

    const next = addSession(new Date("2026-11-10T00:00:00.000Z"));
    await bookingService.bookMemberSession(userId, next.id, { accepted: true }, "GROUP");

    const membership = membershipFor(checkout.id)!;
    expect(membership.creditsUsed).toBe(2);
    expect(membership.startDate).toEqual(CLASS_DATE);
  });

  it("never creates a second calendar event for the same booking", async () => {
    const plan = groupMonthly();
    const session = addSession(CLASS_DATE);
    const checkout = await offlineCheckout(plan, { session });
    await adminService.confirmOfflinePayment(checkout.id);

    await bookingService.confirmOfflinePaidBooking(checkout.id);
    await Promise.all([
      bookingService.confirmOfflinePaidBooking(checkout.id),
      bookingService.confirmOfflinePaidBooking(checkout.id),
    ]);

    expect(createBookingEvent).toHaveBeenCalledTimes(1);
    expect(membershipFor(checkout.id)!.creditsUsed).toBe(1);
  });
});

// ---------------------------------------------------------------------
// 4, 5, 6. Selected class, cannot be confirmed
// ---------------------------------------------------------------------

describe("selected class that can't be confirmed when the admin confirms payment", () => {
  async function expectPaidButNotBooked(checkout: Row, reason: string) {
    const result: any = await adminService.confirmOfflinePayment(checkout.id);

    expect(result.paymentConfirmed).toBe(true);
    expect(result.classBooking.status).toBe("NOT_CONFIRMED");
    expect(result.classBooking.reason).toContain(reason);
    expect(result.classBooking.resolution).toMatch(/refund/);
    expect(result.activationUrl).toBeTruthy();

    // Payment kept; booking not confirmed; nothing charged; membership
    // waits for its first booked class.
    expect(booking(checkout.id)).toMatchObject({
      paymentStatus: "PAID",
      bookingStatus: "PENDING",
    });
    expect(membershipFor(checkout.id)).toMatchObject({
      creditsUsed: 0,
      startDate: null,
      expiryDate: null,
    });
    expect(createBookingEvent).not.toHaveBeenCalled();

    expect(createForAllAdmins).toHaveBeenCalledTimes(1);
    expect(createForAllAdmins).toHaveBeenCalledWith(
      expect.objectContaining({ eventKey: `offline-class-not-confirmed:${checkout.id}` })
    );
    return result;
  }

  it("session full by the time the admin confirms", async () => {
    const plan = groupMonthly();
    const session = addSession(CLASS_DATE);
    const checkout = await offlineCheckout(plan, { session });
    fillSession(session, plan, 5);

    await expectPaidButNotBooked(checkout, "This group session is full.");
  });

  it("session now inside the two-hour cutoff", async () => {
    const plan = groupMonthly();
    const session = addSession(CLASS_DATE);
    const checkout = await offlineCheckout(plan, { session });

    // 08:30 UTC on the class day; it starts at 09:00 UTC (10:00 Lagos).
    vi.setSystemTime(new Date("2026-11-03T08:30:00.000Z"));

    await expectPaidButNotBooked(checkout, "at least two hours");
  });

  it("session cancelled before the admin confirms", async () => {
    const plan = groupMonthly();
    const session = addSession(CLASS_DATE);
    const checkout = await offlineCheckout(plan, { session });
    fake.get("classSession", session.id).status = "CANCELLED";

    await expectPaidButNotBooked(checkout, "no longer available");
  });

  it("no health declaration", async () => {
    const plan = groupMonthly();
    const session = addSession(CLASS_DATE);
    const checkout = await offlineCheckout(plan, { session, healthDeclaration: false });

    await expectPaidButNotBooked(checkout, "Health Declaration");
  });

  it("the member can still book another session with the full credits", async () => {
    const plan = groupMonthly();
    const session = addSession(CLASS_DATE);
    const checkout = await offlineCheckout(plan, { session });
    fillSession(session, plan, 5);

    const result = await expectPaidButNotBooked(checkout, "full");
    const userId = await activate(result.activationUrl);

    const other = addSession(new Date("2026-11-05T00:00:00.000Z"));
    await bookingService.bookMemberSession(userId, other.id, { accepted: true }, "GROUP");

    const membership = membershipFor(checkout.id)!;
    expect(membership.creditsUsed).toBe(1);
    expect(membership.startDate).toEqual(new Date("2026-11-05T00:00:00.000Z"));
  });
});

// ---------------------------------------------------------------------
// 7, 8. Duplicates and retries
// ---------------------------------------------------------------------

describe("duplicate and retried confirmations", () => {
  it("a second confirmation is refused and changes nothing", async () => {
    const plan = groupMonthly();
    const session = addSession(CLASS_DATE);
    const checkout = await offlineCheckout(plan, { session });
    await adminService.confirmOfflinePayment(checkout.id);

    await expect(adminService.confirmOfflinePayment(checkout.id)).rejects.toThrow(
      "already been confirmed"
    );

    expect(memberships()).toHaveLength(1);
    expect(activations()).toHaveLength(1);
    expect(membershipFor(checkout.id)!.creditsUsed).toBe(1);
    expect(createBookingEvent).toHaveBeenCalledTimes(1);
    expect(activationEmails()).toBe(1);
  });

  it("two confirmations at the same time: one succeeds, nothing is duplicated", async () => {
    const plan = groupMonthly();
    const session = addSession(CLASS_DATE);
    const checkout = await offlineCheckout(plan, { session });

    const results = await Promise.allSettled([
      adminService.confirmOfflinePayment(checkout.id),
      adminService.confirmOfflinePayment(checkout.id),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(memberships()).toHaveLength(1);
    expect(activations()).toHaveLength(1);
    expect(membershipFor(checkout.id)!.creditsUsed).toBe(1);
    expect(booking(checkout.id).bookingStatus).toBe("CONFIRMED");
    expect(createBookingEvent).toHaveBeenCalledTimes(1);
    expect(activationEmails()).toBe(1);
  });

  it("a retry after the class failed books it once the problem is fixed", async () => {
    const plan = groupMonthly();
    const session = addSession(CLASS_DATE);
    const checkout = await offlineCheckout(plan, { session });
    const others = fillSession(session, plan, 5);

    const first: any = await adminService.confirmOfflinePayment(checkout.id);
    expect(first.classBooking.status).toBe("NOT_CONFIRMED");

    // Retrying while still full fails again, without a second
    // membership, email or notification.
    const again: any = await adminService.confirmOfflinePayment(checkout.id);
    expect(again.retried).toBe(true);
    expect(again.classBooking.status).toBe("NOT_CONFIRMED");

    // A place opens up.
    fake.get("booking", others[0].id).bookingStatus = "CANCELLED";

    const retry: any = await adminService.confirmOfflinePayment(checkout.id);

    expect(retry).toMatchObject({ retried: true, classBooking: { status: "CONFIRMED" } });
    expect(booking(checkout.id).bookingStatus).toBe("CONFIRMED");
    expect(memberships()).toHaveLength(1);
    expect(activations()).toHaveLength(1);
    expect(membershipFor(checkout.id)).toMatchObject({
      creditsUsed: 1,
      startDate: CLASS_DATE,
    });
    expect(createBookingEvent).toHaveBeenCalledTimes(1);
    expect(activationEmails()).toBe(1);
    // Same event key each time, so admins get one notification.
    const keys = new Set(createForAllAdmins.mock.calls.map((call: any[]) => call[0].eventKey));
    expect([...keys]).toEqual([`offline-class-not-confirmed:${checkout.id}`]);

    // And once confirmed, further confirmations are refused.
    await expect(adminService.confirmOfflinePayment(checkout.id)).rejects.toThrow(
      "already been confirmed"
    );
  });

  it("a retry is refused once another booking has started the membership", async () => {
    const plan = groupMonthly();
    const session = addSession(CLASS_DATE);
    const checkout = await offlineCheckout(plan, { session });
    const others = fillSession(session, plan, 5);

    const first: any = await adminService.confirmOfflinePayment(checkout.id);
    const userId = await activate(first.activationUrl);
    const other = addSession(new Date("2026-11-05T00:00:00.000Z"));
    await bookingService.bookMemberSession(userId, other.id, { accepted: true }, "GROUP");
    fake.get("booking", others[0].id).bookingStatus = "CANCELLED";

    await expect(adminService.confirmOfflinePayment(checkout.id)).rejects.toThrow(
      "already started from another booking"
    );
    expect(membershipFor(checkout.id)).toMatchObject({
      creditsUsed: 1,
      startDate: new Date("2026-11-05T00:00:00.000Z"),
    });
  });

  it("a failed activation releases the payment so the admin can confirm again", async () => {
    const plan = groupMonthly();
    const session = addSession(CLASS_DATE);
    const checkout = await offlineCheckout(plan, { session });

    emailFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "provider down",
      json: async () => ({}),
    } as any);

    await expect(adminService.confirmOfflinePayment(checkout.id)).rejects.toThrow();
    expect(booking(checkout.id)).toMatchObject({
      paymentStatus: "PENDING",
      bookingStatus: "PENDING",
    });
    expect(memberships()).toHaveLength(0);
    expect(activations()).toHaveLength(0);

    const result: any = await adminService.confirmOfflinePayment(checkout.id);
    expect(result.classBooking.status).toBe("CONFIRMED");
    expect(memberships()).toHaveLength(1);
    expect(membershipFor(checkout.id)!.creditsUsed).toBe(1);
  });
});

// ---------------------------------------------------------------------
// 10. GROUP and PRIVATE
// ---------------------------------------------------------------------

describe("GROUP and PRIVATE memberships", () => {
  it("PRIVATE: confirmed through the private rules, one credit, package has no expiry", async () => {
    const plan = privatePackage();
    const session = addSession(CLASS_DATE);
    const checkout = await offlineCheckout(plan, { session });

    const result: any = await adminService.confirmOfflinePayment(checkout.id);

    expect(result.classBooking.status).toBe("CONFIRMED");
    expect(membershipFor(checkout.id)).toMatchObject({
      creditsTotal: 5,
      creditsUsed: 1,
      startDate: CLASS_DATE,
      expiryDate: null,
    });
    expect(createBookingEvent).toHaveBeenCalledTimes(1);
  });

  it("PRIVATE: a session someone else has booked since checkout is refused", async () => {
    const plan = privatePackage();
    const groupPlan = groupMonthly();
    const session = addSession(CLASS_DATE);
    const checkout = await offlineCheckout(plan, { session });
    fillSession(session, groupPlan, 1);

    const result: any = await adminService.confirmOfflinePayment(checkout.id);

    expect(result.classBooking.status).toBe("NOT_CONFIRMED");
    expect(result.classBooking.reason).toContain("cannot be booked privately");
    expect(membershipFor(checkout.id)!.creditsUsed).toBe(0);
  });

  it("GROUP: a session reserved for a private booking is refused", async () => {
    const plan = groupMonthly();
    const privatePlan = privatePackage();
    const session = addSession(CLASS_DATE);
    const checkout = await offlineCheckout(plan, { session });
    fillSession(session, privatePlan, 1);

    const result: any = await adminService.confirmOfflinePayment(checkout.id);

    expect(result.classBooking.status).toBe("NOT_CONFIRMED");
    expect(result.classBooking.reason).toContain("reserved for a private booking");
    expect(membershipFor(checkout.id)!.creditsUsed).toBe(0);
  });
});
