/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed results and mock call arguments */
/**
 * Offline membership PURCHASE confirmation, activation and first-class
 * retry, in memory (Prisma replaced by tests/helpers/fake-prisma).
 *
 * Real code throughout: initiateOfflineMembershipPurchase,
 * AdminService.confirmOfflineMembershipPurchase /
 * retryOfflineMembershipFirstBooking, createActivationForPurchase,
 * BookingService.createMembershipFirstBooking and the normal booking
 * confirmation, completeActivation and bookMemberSession.
 * Stubbed: Google Calendar (counted), the activation email transport
 * (counted, no network), admin notifications and the mailer.
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

vi.mock("../../src/admin/admin-notification.service.js", () => ({
  adminNotificationService: {
    createForAllAdmins: vi.fn(async () => ({ created: 0, pushSent: 0 })),
  },
}));

const { adminService } = await import("../../src/admin/admin.service.js");
const { default: membershipService } = await import(
  "../../src/membership/membership.service.js"
);
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
const PURCHASE_TIME = new Date("2026-10-24T09:00:00.000Z");
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

/** The customer's offline (bank transfer) membership purchase. */
async function offlinePurchase(plan: Row, session?: Row) {
  const result = await membershipService.initiateOfflineMembershipPurchase({
    membershipId: plan.id,
    fullName: "Offline Customer",
    email: EMAIL,
    phone: "08000000000",
    userId: null,
    firstSessionId: session?.id ?? null,
    healthDeclarationAccepted: Boolean(session),
  });
  return fake.get("membershipPurchase", result.purchaseId);
}

const confirm = (purchaseId: string) =>
  adminService.confirmOfflineMembershipPurchase(purchaseId) as Promise<any>;

const retry = (purchaseId: string) =>
  adminService.retryOfflineMembershipFirstBooking(purchaseId) as Promise<any>;

const membershipFor = (purchaseId: string) =>
  fake.tables.memberMembership.find((row) => row.membershipPurchaseId === purchaseId)!;

const firstBooking = (purchase: Row) =>
  fake.tables.booking.find(
    (row) => row.paymentReference === `${purchase.paymentReference}-FIRST-BOOKING`
  );

const counts = () => ({
  purchases: fake.tables.membershipPurchase.length,
  memberships: fake.tables.memberMembership.length,
  activations: fake.tables.membershipActivation.length,
  users: fake.tables.user.length,
  firstBookings: fake.tables.booking.filter((row) =>
    String(row.paymentReference).endsWith("-FIRST-BOOKING")
  ).length,
});

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
  emailFetch.mockClear();

  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(PURCHASE_TIME);

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
// The acceptance test
// ---------------------------------------------------------------------

describe("acceptance", () => {
  it("payment succeeds, class fails, customer still gets the activation email, admin retries later, the original booking confirms with exactly one credit", async () => {
    const plan = groupMonthly();
    const session = addSession(CLASS_DATE);
    const purchase = await offlinePurchase(plan, session);
    const others = fillSession(session, plan, 5); // full by the time the admin confirms

    // 1. Admin confirms the transfer: the class can't be booked.
    const confirmed = await confirm(purchase.id);

    expect(confirmed.summary).toEqual({
      payment: "PAID",
      membershipActivation: "CREATED",
      activationEmail: "SENT",
      firstClass: "NOT_CONFIRMED",
      firstClassFailureReason: "This group session is full.",
      retryAvailable: true,
    });
    expect(fake.get("membershipPurchase", purchase.id).paymentStatus).toBe("PAID");

    // 2. The customer still got the activation email; nothing was charged.
    expect(activationEmails()).toBe(1);
    expect(membershipFor(purchase.id)).toMatchObject({
      creditsUsed: 0,
      startDate: null,
      expiryDate: null,
    });
    expect(firstBooking(purchase)!.bookingStatus).toBe("PENDING");

    // 3. The customer activates their account.
    const userId = await activate(confirmed.activation.activationUrl);
    expect(fake.get("user", userId).password).toBeTruthy();

    // 4. A place opens; the admin retries later.
    fake.get("booking", others[0].id).bookingStatus = "CANCELLED";
    const before = counts();
    const retried = await retry(purchase.id);

    // 5. The original booking confirms, with exactly one credit.
    expect(retried.firstClass).toMatchObject({
      status: "CONFIRMED",
      bookingId: firstBooking(purchase)!.id,
    });
    expect(firstBooking(purchase)).toMatchObject({
      bookingStatus: "CONFIRMED",
      userId,
      calendarEventId: `evt_${firstBooking(purchase)!.id}`,
    });
    expect(membershipFor(purchase.id)).toMatchObject({
      creditsUsed: 1,
      startDate: CLASS_DATE,
      expiryDate: addMonths(CLASS_DATE, 1),
    });
    expect(createBookingEvent).toHaveBeenCalledTimes(1);
    expect(counts()).toEqual(before); // nothing new created
    expect(activationEmails()).toBe(1);
  });
});

// ---------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------

describe("activation", () => {
  it("1. membership-only purchase: activation created, no class", async () => {
    const plan = groupMonthly();
    const purchase = await offlinePurchase(plan);

    const result = await confirm(purchase.id);

    expect(result.summary).toMatchObject({
      payment: "PAID",
      membershipActivation: "CREATED",
      activationEmail: "SENT",
      firstClass: "NOT_SELECTED",
      retryAvailable: false,
    });
    expect(fake.tables.membershipActivation).toHaveLength(1);
    expect(membershipFor(purchase.id)).toMatchObject({ startDate: null, creditsUsed: 0 });
  });

  it("2. selected class that can be booked: class confirmed and activation created", async () => {
    const plan = groupMonthly();
    const session = addSession(CLASS_DATE);
    const purchase = await offlinePurchase(plan, session);

    const result = await confirm(purchase.id);

    expect(result.summary).toMatchObject({
      membershipActivation: "CREATED",
      activationEmail: "SENT",
      firstClass: "CONFIRMED",
    });
    expect(firstBooking(purchase)!.bookingStatus).toBe("CONFIRMED");
    expect(membershipFor(purchase.id)).toMatchObject({
      creditsUsed: 1,
      startDate: CLASS_DATE,
      expiryDate: addMonths(CLASS_DATE, 1),
    });
    expect(createBookingEvent).toHaveBeenCalledTimes(1);
  });

  it("3-5. class fails: activation still created and emailed; no credit; dates stay null; first session kept", async () => {
    const plan = groupMonthly();
    const session = addSession(CLASS_DATE);
    const purchase = await offlinePurchase(plan, session);
    fillSession(session, plan, 5);

    const result = await confirm(purchase.id);

    expect(result.summary.firstClass).toBe("NOT_CONFIRMED");
    expect(result.summary.membershipActivation).toBe("CREATED");
    expect(result.summary.activationEmail).toBe("SENT");
    expect(result.activation.activationUrl).toContain("/activate?membership=");
    expect(activationEmails()).toBe(1);

    expect(membershipFor(purchase.id)).toMatchObject({
      creditsUsed: 0,
      startDate: null,
      expiryDate: null,
    });
    expect(fake.get("membershipPurchase", purchase.id)).toMatchObject({
      paymentStatus: "PAID",
      firstSessionId: session.id,
    });
    expect(createBookingEvent).not.toHaveBeenCalled();
  });

  it("a failed email is reported separately and does not affect payment or class", async () => {
    const plan = groupMonthly();
    const session = addSession(CLASS_DATE);
    const purchase = await offlinePurchase(plan, session);
    emailFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "provider down",
      json: async () => ({}),
    } as any);

    const result = await confirm(purchase.id);

    expect(result.summary).toMatchObject({
      payment: "PAID",
      membershipActivation: "CREATED",
      activationEmail: "FAILED",
      firstClass: "CONFIRMED",
    });
  });

  it("16. the customer can activate and use the membership when the first class wasn't booked", async () => {
    const plan = groupMonthly();
    const session = addSession(CLASS_DATE);
    const purchase = await offlinePurchase(plan, session);
    fillSession(session, plan, 5);
    const result = await confirm(purchase.id);

    const userId = await activate(result.activation.activationUrl);
    const user = fake.get("user", userId);
    expect(user.password).toBeTruthy();
    expect(membershipFor(purchase.id).userId).toBe(userId);

    const credits = await bookingService.getMembershipCreditSummary(userId);
    expect(credits?.remainingCredits).toBe(5);
    expect(credits?.requiresInitialBooking).toBe(true);
  });

  it("11. a membership-only purchase starts on its first booked class", async () => {
    const plan = groupMonthly();
    const purchase = await offlinePurchase(plan);
    const result = await confirm(purchase.id);
    const userId = await activate(result.activation.activationUrl);

    const session = addSession(CLASS_DATE);
    await bookingService.bookMemberSession(userId, session.id, { accepted: true }, "GROUP");

    expect(membershipFor(purchase.id)).toMatchObject({
      creditsUsed: 1,
      startDate: CLASS_DATE,
      expiryDate: addMonths(CLASS_DATE, 1),
    });
  });

  it("activating again reuses everything and sends no new email", async () => {
    const plan = groupMonthly();
    const session = addSession(CLASS_DATE);
    const purchase = await offlinePurchase(plan, session);
    fillSession(session, plan, 5);
    const first = await confirm(purchase.id);
    const before = counts();

    const again: any = await membershipActivationService.createActivationForPurchase(purchase.id);

    expect(again).toMatchObject({
      activationStatus: "EXISTING",
      activationEmail: "NOT_RESENT",
      activationUrl: null,
      membershipNumber: first.activation.membershipNumber,
    });
    expect(counts()).toEqual(before);
    expect(activationEmails()).toBe(1);
  });

  it("a second admin confirmation of the payment is refused", async () => {
    const plan = groupMonthly();
    const purchase = await offlinePurchase(plan);
    await confirm(purchase.id);

    await expect(confirm(purchase.id)).rejects.toThrow("Only pending offline purchases can be confirmed.");
    expect(fake.tables.membershipActivation).toHaveLength(1);
  });

  it("two admin confirmations at the same moment create one activation", async () => {
    const plan = groupMonthly();
    const session = addSession(CLASS_DATE);
    const purchase = await offlinePurchase(plan, session);

    const results = await Promise.allSettled([confirm(purchase.id), confirm(purchase.id)]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(counts()).toMatchObject({ memberships: 1, activations: 1, firstBookings: 1 });
    expect(membershipFor(purchase.id).creditsUsed).toBe(1);
    expect(activationEmails()).toBe(1);
  });
});

// ---------------------------------------------------------------------
// Retry
// ---------------------------------------------------------------------

describe("admin retry of the first class", () => {
  async function failedFirstClass() {
    const plan = groupMonthly();
    const session = addSession(CLASS_DATE);
    const purchase = await offlinePurchase(plan, session);
    const others = fillSession(session, plan, 5);
    const confirmed = await confirm(purchase.id);
    return { plan, session, purchase, others, confirmed };
  }

  it("6, 7, 10. retry confirms the original booking with one credit and creates nothing new", async () => {
    const { purchase, others } = await failedFirstClass();
    const originalBookingId = firstBooking(purchase)!.id;
    fake.get("booking", others[0].id).bookingStatus = "CANCELLED";
    const before = counts();

    const result = await retry(purchase.id);

    expect(result.firstClass).toMatchObject({ status: "CONFIRMED", bookingId: originalBookingId });
    expect(membershipFor(purchase.id).creditsUsed).toBe(1);
    expect(counts()).toEqual(before);
    expect(fake.get("membershipPurchase", purchase.id).paymentStatus).toBe("PAID");
  });

  it("retry while the problem remains: still not confirmed, nothing charged", async () => {
    const { purchase } = await failedFirstClass();

    const result = await retry(purchase.id);

    expect(result.firstClass).toMatchObject({
      status: "NOT_CONFIRMED",
      reason: "This group session is full.",
      retryAvailable: true,
    });
    expect(membershipFor(purchase.id)).toMatchObject({ creditsUsed: 0, startDate: null });
  });

  it("8, 9. retrying an already-confirmed first class uses no credit and adds no calendar event", async () => {
    const plan = groupMonthly();
    const session = addSession(CLASS_DATE);
    const purchase = await offlinePurchase(plan, session);
    await confirm(purchase.id);

    const first = await retry(purchase.id);
    const second = await retry(purchase.id);

    expect(first.firstClass.status).toBe("CONFIRMED");
    expect(second.firstClass.status).toBe("CONFIRMED");
    expect(membershipFor(purchase.id).creditsUsed).toBe(1);
    expect(createBookingEvent).toHaveBeenCalledTimes(1);
  });

  it("refused once another booking has started the membership", async () => {
    const { purchase, others, confirmed } = await failedFirstClass();
    const userId = await activate(confirmed.activation.activationUrl);
    const other = addSession(new Date("2026-11-05T00:00:00.000Z"));
    await bookingService.bookMemberSession(userId, other.id, { accepted: true }, "GROUP");
    fake.get("booking", others[0].id).bookingStatus = "CANCELLED";

    const result = await retry(purchase.id);

    expect(result.firstClass).toMatchObject({ status: "NOT_CONFIRMED", retryAvailable: false });
    expect(result.firstClass.reason).toContain("already started from another booking");
    expect(firstBooking(purchase)!.bookingStatus).toBe("PENDING");
    expect(membershipFor(purchase.id)).toMatchObject({
      creditsUsed: 1,
      startDate: new Date("2026-11-05T00:00:00.000Z"),
    });
  });

  it("refuses purchases that aren't paid, aren't offline, have no class or no activation", async () => {
    const plan = groupMonthly();
    const session = addSession(CLASS_DATE);

    const pending = await offlinePurchase(plan, session);
    await expect(retry(pending.id)).rejects.toThrow("has not been confirmed yet");

    const membershipOnly = await offlinePurchase(plan);
    await confirm(membershipOnly.id);
    await expect(retry(membershipOnly.id)).rejects.toThrow("no selected first class");

    const online = fake.insert("membershipPurchase", {
      email: EMAIL,
      membershipId: plan.id,
      type: "NEW",
      amount: 1,
      paymentReference: "SL-ONLINE-1",
      paymentMethod: "PAYMISH",
      paymentStatus: "PAID",
      firstSessionId: session.id,
    });
    await expect(retry(online.id)).rejects.toThrow("not an offline payment");
  });
});

// ---------------------------------------------------------------------
// Booking safeguards
// ---------------------------------------------------------------------

describe("booking safeguards still apply to the first class", () => {
  async function expectNotConfirmed(purchase: Row, reason: string) {
    const result = await confirm(purchase.id);
    expect(result.summary.membershipActivation).toBe("CREATED");
    expect(result.summary.activationEmail).toBe("SENT");
    expect(result.summary.firstClass).toBe("NOT_CONFIRMED");
    expect(result.summary.firstClassFailureReason).toContain(reason);
    expect(membershipFor(purchase.id)).toMatchObject({ creditsUsed: 0, startDate: null });
    expect(createBookingEvent).not.toHaveBeenCalled();
  }

  it("13. a full session", async () => {
    const plan = groupMonthly();
    const session = addSession(CLASS_DATE);
    const purchase = await offlinePurchase(plan, session);
    fillSession(session, plan, 5);
    await expectNotConfirmed(purchase, "full");
  });

  it("13. a cancelled session", async () => {
    const plan = groupMonthly();
    const session = addSession(CLASS_DATE);
    const purchase = await offlinePurchase(plan, session);
    fake.get("classSession", session.id).status = "CANCELLED";
    await expectNotConfirmed(purchase, "no longer available");
  });

  it("14. the two-hour cutoff", async () => {
    const plan = groupMonthly();
    const session = addSession(CLASS_DATE);
    const purchase = await offlinePurchase(plan, session);
    vi.setSystemTime(new Date("2026-11-03T08:30:00.000Z")); // class at 09:00 UTC
    await expectNotConfirmed(purchase, "at least two hours");
  });

  it("15. a missing health declaration", async () => {
    const plan = groupMonthly();
    const session = addSession(CLASS_DATE);
    const purchase = await offlinePurchase(plan, session);
    fake.get("membershipPurchase", purchase.id).healthDeclarationAccepted = false;
    await expectNotConfirmed(purchase, "health and safety declaration");
  });

  it("12. PRIVATE: a session someone else has booked can't be booked privately", async () => {
    const plan = privatePackage();
    const groupPlan = groupMonthly();
    const session = addSession(CLASS_DATE);
    const purchase = await offlinePurchase(plan, session);
    fillSession(session, groupPlan, 1);
    await expectNotConfirmed(purchase, "cannot be booked privately");
  });

  it("12. GROUP: a session reserved for a private booking can't be booked", async () => {
    const plan = groupMonthly();
    const privatePlan = privatePackage();
    const session = addSession(CLASS_DATE);
    const purchase = await offlinePurchase(plan, session);
    fillSession(session, privatePlan, 1);
    await expectNotConfirmed(purchase, "reserved for a private booking");
  });

  it("12. PRIVATE: an available session is booked with one credit; the package has no expiry", async () => {
    const plan = privatePackage();
    const session = addSession(CLASS_DATE);
    const purchase = await offlinePurchase(plan, session);

    const result = await confirm(purchase.id);

    expect(result.summary.firstClass).toBe("CONFIRMED");
    expect(membershipFor(purchase.id)).toMatchObject({
      creditsUsed: 1,
      startDate: CLASS_DATE,
      expiryDate: null,
    });
  });
});
