/**
 * In-memory tests (Prisma replaced by tests/helpers/fake-prisma):
 *
 * 1. Every seeded plan's validity, through each NEW activation path:
 *    Paymish with a first session, Paymish membership-only, offline
 *    with a first session, offline membership-only.
 * 2. A queued early renewal's credits are not used before it starts.
 * 3. Several unstarted purchases of the same type keep every package's
 *    duration exactly once, with or without an upgrade.
 * 4. FAILED (cancelled or superseded) purchases cannot be completed.
 *
 * Locking under real concurrency is tested against PostgreSQL in
 * tests/postgres; the fake does not model row locks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePrisma, type Row } from "../helpers/fake-prisma";
import { SEEDED_PLANS, addMonths } from "../helpers/seeded-plans";

const fake = createFakePrisma();

vi.mock("../../src/config/prisma.js", () => ({ default: fake.prisma }));

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

const USER_ID = "user_1";
const EMAIL = "member@example.com";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

// Paid on October 24; first class on November 3.
const PAYMENT_DATE = new Date("2026-10-24T09:00:00.000Z");
const FIRST_SESSION_DATE = d("2026-11-03");

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

function addSession(sessionDate: Date) {
  const schedule = fake.insert("schedule", {
    className: "Reformer",
    tutorName: "Tutor",
    code: "REF",
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

const row = (id: string) => fake.get("memberMembership", id);

const rowForPurchase = (purchaseId: string) =>
  fake.tables.memberMembership.find(
    (item) => item.membershipPurchaseId === purchaseId
  )!;

const purchaseByReference = (reference: string) =>
  fake.tables.membershipPurchase.find(
    (item) => item.paymentReference === reference
  )!;

const activeRows = () =>
  fake.tables.memberMembership.filter(
    (item) => item.userId === USER_ID && item.status === "ACTIVE"
  );

function tick() {
  vi.setSystemTime(new Date(Date.now() + 60_000));
}

async function bookSession(sessionDate: Date, type: "GROUP" | "PRIVATE" = "GROUP") {
  const session = addSession(sessionDate);
  return bookingService.bookMemberSession(USER_ID, session.id, { accepted: true }, type);
}

/** A NEW membership-only purchase, completed but not yet booked. */
function addUnstarted(plan: Row) {
  const purchase = fake.insert("membershipPurchase", {
    userId: USER_ID,
    email: EMAIL,
    membershipId: plan.id,
    type: "NEW",
    paymentStatus: "PAID",
    paymentReference: `SL-NEW-${fake.tables.membershipPurchase.length + 1}`,
    amount: plan.price,
  });

  return fake.insert("memberMembership", {
    userId: USER_ID,
    membershipId: plan.id,
    membershipPurchaseId: purchase.id,
    status: "ACTIVE",
    creditsTotal: plan.classLimit,
    creditsUsed: 0,
  });
}

const requiresInitialBooking = async () =>
  (await bookingService.getMembershipCreditSummary(USER_ID))?.requiresInitialBooking;

beforeEach(() => {
  fake.reset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(PAYMENT_DATE);

  // No activation email is sent: there is no RESEND_API_KEY, and no
  // network call may leave the test.
  delete process.env.RESEND_API_KEY;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("Network access is disabled in tests.");
    })
  );

  fake.insert("user", {
    id: USER_ID,
    fullName: "Test Member",
    email: EMAIL,
    phone: "08000000000",
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------
// 1. Seeded plan validity through every NEW activation path
// ---------------------------------------------------------------------

describe.each(SEEDED_PLANS)("NEW activation: $label", ({ plan: planData, expiryFrom }) => {
  const credits = (used: number) =>
    planData.classLimit === null ? 0 : used;

  it("Paymish with a first session: starts on the session date, not the payment date", async () => {
    const plan = addPlan(planData);
    const session = addSession(FIRST_SESSION_DATE);

    const purchase = await membershipService.initiateNewMembershipPurchase({
      membershipId: plan.id,
      fullName: "Test Member",
      email: EMAIL,
      phone: "08000000000",
      userId: USER_ID,
      firstSessionId: session.id,
      healthDeclarationAccepted: true,
    });

    await membershipService.completeMembershipPurchase(purchase.reference);

    const membership = rowForPurchase(purchaseByReference(purchase.reference).id);
    expect(membership.startDate).toEqual(FIRST_SESSION_DATE);
    expect(membership.expiryDate).toEqual(expiryFrom(FIRST_SESSION_DATE));
    expect(membership.creditsUsed).toBe(credits(1));

    const firstBooking = fake.tables.booking.find(
      (item) => item.memberMembershipId === membership.id
    )!;
    expect(firstBooking.bookingStatus).toBe("CONFIRMED");
    expect(firstBooking.sessionId).toBe(session.id);
  });

  it("Paymish membership-only: waits, then starts on the first booked session", async () => {
    const plan = addPlan(planData);

    const purchase = await membershipService.initiateNewMembershipPurchase({
      membershipId: plan.id,
      fullName: "Test Member",
      email: EMAIL,
      phone: "08000000000",
      userId: USER_ID,
    });

    await membershipService.completeMembershipPurchase(purchase.reference);

    const membership = rowForPurchase(purchaseByReference(purchase.reference).id);
    expect(membership.startDate).toBeNull();
    expect(membership.expiryDate).toBeNull();

    await bookSession(FIRST_SESSION_DATE, planData.type);

    expect(row(membership.id).startDate).toEqual(FIRST_SESSION_DATE);
    expect(row(membership.id).expiryDate).toEqual(expiryFrom(FIRST_SESSION_DATE));
    expect(row(membership.id).creditsUsed).toBe(credits(1));
  });

  it("offline with a first session: starts on the session date, not the approval date", async () => {
    const plan = addPlan(planData);
    const session = addSession(FIRST_SESSION_DATE);

    const purchase = await membershipService.initiateOfflineMembershipPurchase({
      membershipId: plan.id,
      fullName: "Test Member",
      email: EMAIL,
      phone: "08000000000",
      userId: USER_ID,
      firstSessionId: session.id,
      healthDeclarationAccepted: true,
    });

    // What the admin approval does: mark PAID, then activate.
    vi.setSystemTime(new Date("2026-10-26T12:00:00.000Z"));
    fake.get("membershipPurchase", purchase.purchaseId).paymentStatus = "PAID";
    await membershipActivationService.createActivationForPurchase(purchase.purchaseId);

    const membership = rowForPurchase(purchase.purchaseId);
    expect(membership.startDate).toEqual(FIRST_SESSION_DATE);
    expect(membership.expiryDate).toEqual(expiryFrom(FIRST_SESSION_DATE));
    expect(membership.creditsUsed).toBe(credits(1));
  });

  it("offline membership-only: waits, then starts on the first booked session", async () => {
    const plan = addPlan(planData);

    const purchase = await membershipService.initiateOfflineMembershipPurchase({
      membershipId: plan.id,
      fullName: "Test Member",
      email: EMAIL,
      phone: "08000000000",
      userId: USER_ID,
    });

    fake.get("membershipPurchase", purchase.purchaseId).paymentStatus = "PAID";
    await membershipActivationService.createActivationForPurchase(purchase.purchaseId);

    const membership = rowForPurchase(purchase.purchaseId);
    expect(membership.startDate).toBeNull();
    expect(membership.expiryDate).toBeNull();

    await bookSession(FIRST_SESSION_DATE, planData.type);

    expect(row(membership.id).startDate).toEqual(FIRST_SESSION_DATE);
    expect(row(membership.id).expiryDate).toEqual(expiryFrom(FIRST_SESSION_DATE));
  });
});

// ---------------------------------------------------------------------
// 2. Queued renewal credits
// ---------------------------------------------------------------------

describe("queued early renewal", () => {
  let monthly: Row;
  let current: Row;
  let renewal: Row;

  beforeEach(async () => {
    vi.setSystemTime(d("2026-11-08"));
    monthly = addPlan({ type: "GROUP", duration: "Monthly", period: "/month", classLimit: 8 });
    current = fake.insert("memberMembership", {
      userId: USER_ID,
      membershipId: monthly.id,
      status: "ACTIVE",
      startDate: d("2026-11-01"),
      expiryDate: d("2026-12-01"),
      creditsTotal: 8,
      creditsUsed: 7, // one credit left
    });

    tick();
    const result = await membershipService.initiateRenewal(USER_ID);
    await membershipService.completeMembershipPurchase(result.reference);
    renewal = rowForPurchase(purchaseByReference(result.reference).id);
    expect(renewal.startDate).toEqual(d("2026-12-01"));
  });

  it("uses the current membership's credits before the renewal starts", async () => {
    const booking = await bookSession(d("2026-11-20"));

    expect(booking.memberMembershipId).toBe(current.id);
    expect(row(current.id).creditsUsed).toBe(8);
    expect(row(renewal.id).creditsUsed).toBe(0);
  });

  it("does not use the renewal's credits for a session before it starts", async () => {
    await bookSession(d("2026-11-20")); // uses the last current credit

    const bookingsBefore = fake.tables.booking.length;

    await expect(bookSession(d("2026-11-25"))).rejects.toThrow(
      "Your next membership starts on 2026-12-01"
    );

    expect(row(renewal.id).creditsUsed).toBe(0);
    expect(fake.tables.booking).toHaveLength(bookingsBefore);
  });

  it("uses the renewal for sessions from its start date", async () => {
    await bookSession(d("2026-11-20"));

    const booking = await bookSession(d("2026-12-05"));

    expect(booking.memberMembershipId).toBe(renewal.id);
    expect(row(renewal.id).creditsUsed).toBe(1);
    // Booking it does not restart the renewal.
    expect(row(renewal.id).startDate).toEqual(d("2026-12-01"));
  });

  it("becomes the membership in use once the current one has expired", async () => {
    vi.setSystemTime(d("2026-12-02"));

    const booking = await bookSession(d("2026-12-10"));

    expect(booking.memberMembershipId).toBe(renewal.id);
    expect(row(current.id).creditsUsed).toBe(7);
  });

  it("keeps GROUP and PRIVATE separate: a queued GROUP renewal never serves PRIVATE", async () => {
    await expect(bookSession(d("2026-12-05"), "PRIVATE")).rejects.toThrow(
      "You do not have an active private membership."
    );
    expect(row(renewal.id).creditsUsed).toBe(0);
  });

  it("still lets an awaiting membership-only purchase take its first booking", async () => {
    const privatePlan = addPlan({ type: "PRIVATE", duration: "Monthly", period: "/month", classLimit: 4 });
    const awaiting = addUnstarted(privatePlan);

    const booking = await bookSession(d("2026-11-20"), "PRIVATE");

    expect(booking.memberMembershipId).toBe(awaiting.id);
    expect(row(awaiting.id).startDate).toEqual(d("2026-11-20"));
    expect(row(awaiting.id).expiryDate).toEqual(addMonths(d("2026-11-20"), 1));
    expect(row(current.id).creditsUsed).toBe(7);
    expect(row(renewal.id).creditsUsed).toBe(0);
  });
});

// ---------------------------------------------------------------------
// 3. Several unstarted purchases of the same type
// ---------------------------------------------------------------------

describe("several unstarted membership-only purchases", () => {
  let monthly: Row;
  let twoMonth: Row;

  beforeEach(() => {
    vi.setSystemTime(d("2026-11-08"));
    monthly = addPlan({ type: "GROUP", duration: "Monthly", period: "/month", classLimit: 8 });
    twoMonth = addPlan({ type: "GROUP", duration: "2 Months", period: "/2 months", classLimit: 16 });
  });

  it("the first booking starts the first and queues the second after it", async () => {
    const first = addUnstarted(monthly);
    const second = addUnstarted(monthly);

    const booking = await bookSession(d("2026-11-20"));

    expect(booking.memberMembershipId).toBe(first.id);
    expect(row(first.id).startDate).toEqual(d("2026-11-20"));
    expect(row(first.id).expiryDate).toEqual(addMonths(d("2026-11-20"), 1));
    expect(row(second.id).startDate).toEqual(addMonths(d("2026-11-20"), 1));
    expect(row(second.id).expiryDate).toEqual(addMonths(d("2026-11-20"), 2));
    expect(row(second.id).creditsUsed).toBe(0);
    expect(await requiresInitialBooking()).toBe(false);
  });

  it("an upgrade keeps both purchased durations and carries both sets of credits once", async () => {
    const first = addUnstarted(monthly);
    const second = addUnstarted(monthly);

    tick();
    const result = await membershipService.initiateUpgrade(USER_ID, twoMonth.id);
    await membershipService.completeMembershipPurchase(result.reference);
    const upgraded = rowForPurchase(purchaseByReference(result.reference).id);

    // 16 new + 8 + 8 unused carried; nothing used yet.
    expect(upgraded.creditsTotal).toBe(32);
    expect(upgraded.creditsUsed).toBe(0);
    expect(upgraded.startDate).toBeNull();
    expect(row(first.id).status).toBe("EXPIRED");
    expect(row(second.id).status).toBe("EXPIRED");
    expect(activeRows().map((item) => item.id)).toEqual([upgraded.id]);

    // The replaced purchases are linked into one chain.
    const secondPurchase = fake.get("membershipPurchase", second.membershipPurchaseId);
    expect(secondPurchase.previousMemberMembershipId).toBe(first.id);
    expect(purchaseByReference(result.reference).previousMemberMembershipId).toBe(second.id);

    await bookSession(d("2026-11-20"));

    // 1 month + 1 month + 2 months from the first class.
    expect(row(upgraded.id).startDate).toEqual(d("2026-11-20"));
    expect(row(upgraded.id).expiryDate).toEqual(
      addMonths(addMonths(addMonths(d("2026-11-20"), 1), 1), 2)
    );
    expect(row(upgraded.id).creditsUsed).toBe(1);
  });

  it("an upgrade of a running membership plus an unstarted purchase adds the unstarted duration", async () => {
    const running = fake.insert("memberMembership", {
      userId: USER_ID,
      membershipId: monthly.id,
      status: "ACTIVE",
      startDate: d("2026-11-01"),
      expiryDate: d("2026-12-01"),
      creditsTotal: 8,
      creditsUsed: 3,
    });
    const unstarted = addUnstarted(monthly);

    tick();
    const result = await membershipService.initiateUpgrade(USER_ID, twoMonth.id);
    await membershipService.completeMembershipPurchase(result.reference);
    const upgraded = rowForPurchase(purchaseByReference(result.reference).id);

    // Dec 1 + 1 month (unstarted package) + 2 months (upgrade).
    expect(upgraded.expiryDate).toEqual(addMonths(addMonths(d("2026-12-01"), 1), 2));
    expect(upgraded.startDate).toEqual(d("2026-11-01"));
    // 16 new + (5 + 8) unused carried + 3 used kept.
    expect(upgraded.creditsTotal).toBe(32);
    expect(upgraded.creditsUsed).toBe(3);
    expect(row(running.id).status).toBe("EXPIRED");
    expect(row(unstarted.id).status).toBe("EXPIRED");
    expect(activeRows().map((item) => item.id)).toEqual([upgraded.id]);
  });
});

// ---------------------------------------------------------------------
// 4. FAILED and superseded purchases
// ---------------------------------------------------------------------

describe("FAILED or superseded purchases", () => {
  let monthly: Row;
  let twoMonth: Row;
  let quarterly: Row;
  let current: Row;

  beforeEach(() => {
    vi.setSystemTime(d("2026-11-15"));
    monthly = addPlan({ type: "GROUP", duration: "Monthly", period: "/month", classLimit: 8 });
    twoMonth = addPlan({ type: "GROUP", duration: "2 Months", period: "/2 months", classLimit: 16 });
    quarterly = addPlan({ type: "GROUP", duration: "Quarterly", period: "3 months", classLimit: 24 });
    current = fake.insert("memberMembership", {
      userId: USER_ID,
      membershipId: monthly.id,
      status: "ACTIVE",
      startDate: d("2026-11-01"),
      expiryDate: d("2026-12-01"),
      creditsTotal: 8,
      creditsUsed: 3,
    });
  });

  it("a newer upgrade attempt supersedes an older one for any target, and the older cannot complete", async () => {
    tick();
    const older = await membershipService.initiateUpgrade(USER_ID, twoMonth.id);
    tick();
    const newer = await membershipService.initiateUpgrade(USER_ID, quarterly.id);

    expect(purchaseByReference(older.reference).paymentStatus).toBe("FAILED");
    expect(purchaseByReference(newer.reference).paymentStatus).toBe("PENDING");

    await expect(
      membershipService.completeMembershipPurchase(older.reference)
    ).rejects.toThrow("cancelled or replaced by a newer purchase");

    // Nothing changed.
    expect(row(current.id).status).toBe("ACTIVE");
    expect(rowForPurchase(purchaseByReference(older.reference).id)).toBeUndefined();

    await membershipService.completeMembershipPurchase(newer.reference);
    const upgraded = rowForPurchase(purchaseByReference(newer.reference).id);
    expect(upgraded.membershipId).toBe(quarterly.id);
    expect(activeRows().map((item) => item.id)).toEqual([upgraded.id]);
  });

  it("a superseded renewal cannot complete", async () => {
    tick();
    const older = await membershipService.initiateRenewal(USER_ID);
    tick();
    const newer = await membershipService.initiateRenewal(USER_ID);

    expect(purchaseByReference(older.reference).paymentStatus).toBe("FAILED");

    await expect(
      membershipService.completeMembershipPurchase(older.reference)
    ).rejects.toThrow("cancelled or replaced by a newer purchase");
    expect(activeRows()).toHaveLength(1);

    await membershipService.completeMembershipPurchase(newer.reference);
    expect(activeRows()).toHaveLength(2);
  });

  it("a completed upgrade is not marked FAILED by a later attempt", async () => {
    tick();
    const first = await membershipService.initiateUpgrade(USER_ID, twoMonth.id);
    await membershipService.completeMembershipPurchase(first.reference);

    tick();
    await membershipService.initiateUpgrade(USER_ID, quarterly.id);

    expect(purchaseByReference(first.reference).paymentStatus).toBe("PAID");
  });
});
