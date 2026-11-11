/**
 * BookingService.bookMemberSession: first booking for a membership-only
 * purchase (audit issues C1 and C2), and the requiresInitialBooking flag
 * from getMembershipCreditSummary.
 *
 * Prisma is replaced by the in-memory fake in tests/helpers. Its
 * $transaction restores every table when the callback throws, the way
 * a real rollback would, so failed bookings can be checked for leftover
 * writes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePrisma, type Row } from "../helpers/fake-prisma";

const fake = createFakePrisma();
const fakePrisma = fake.prisma;

vi.mock("../../src/config/prisma.js", () => ({ default: fake.prisma }));

vi.mock("../../src/payment/payment.service.js", () => ({ default: {} }));

vi.mock("../../src/google-calendar/google-calendar.service.js", () => ({
  googleCalendarService: {
    createBookingEvent: vi.fn(async () => ({ eventId: null, eventUrl: null })),
  },
}));

const { default: bookingService } = await import(
  "../../src/booking/booking.service.js"
);

// Live views of the fake's tables (re-read after any rollback).
const store = {
  get bookings() {
    return fake.tables.booking;
  },
  get healthForms() {
    return fake.tables.healthSafetyForm;
  },
};

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------

// The customer pays on October 24; their first class is on November 3.
const PAYMENT_DATE = new Date("2026-10-24T09:00:00.000Z");
const FIRST_SESSION_DATE = new Date("2026-11-03T00:00:00.000Z");
const SECOND_SESSION_DATE = new Date("2026-11-10T00:00:00.000Z");

const USER_ID = "user_1";

function addPlan(type: "GROUP" | "PRIVATE", overrides: Row = {}) {
  return fake.insert("membership", {
    name: `${type} monthly`,
    slug: `${type.toLowerCase()}-${fake.tables.membership.length + 1}`,
    type,
    price: 50000,
    period: "per month",
    classLimit: 8,
    duration: "monthly",
    isActive: true,
    ...overrides,
  });
}

function addSession(
  sessionDate: Date,
  overrides: { status?: string; startTime?: string; isActive?: boolean } = {}
) {
  const schedule = fake.insert("schedule", {
    className: "Reformer",
    tutorName: "Tutor",
    code: "REF",
    dayOfWeek: "TUESDAY",
    startTime: overrides.startTime ?? "10:00",
    endTime: "11:00",
    capacity: 5,
    isActive: overrides.isActive ?? true,
  });

  return fake.insert("classSession", {
    scheduleId: schedule.id,
    sessionDate,
    capacity: null,
    status: overrides.status ?? "OPEN",
  });
}

/** A NEW membership-only purchase, completed but not yet booked. */
function addAwaitingMembership(plan: Row, overrides: Row = {}) {
  const purchase = fake.insert("membershipPurchase", {
    userId: USER_ID,
    email: "member@example.com",
    membershipId: plan.id,
    type: "NEW",
    paymentMethod: "PAYMISH",
    paymentStatus: "PAID",
    paymentReference: `SL-REF-${fake.tables.membershipPurchase.length + 1}`,
    firstSessionId: null,
    amount: plan.price,
    createdAt: PAYMENT_DATE,
  });

  return fake.insert("memberMembership", {
    userId: USER_ID,
    membershipId: plan.id,
    membershipPurchaseId: purchase.id,
    status: "ACTIVE",
    startDate: null,
    expiryDate: null,
    creditsTotal: plan.classLimit,
    creditsUsed: 0,
    ...overrides,
  });
}

/** A membership that is already running (no purchase record). */
function addStartedMembership(plan: Row, overrides: Row = {}) {
  return fake.insert("memberMembership", {
    userId: USER_ID,
    membershipId: plan.id,
    membershipPurchaseId: null,
    status: "ACTIVE",
    startDate: new Date("2026-10-01T00:00:00.000Z"),
    expiryDate: new Date("2026-11-30T00:00:00.000Z"),
    creditsTotal: 8,
    creditsUsed: 2,
    ...overrides,
  });
}

function fillGroupSession(session: Row, plan: Row, count: number) {
  for (let i = 0; i < count; i += 1) {
    fake.insert("booking", {
      userId: `other_user_${i}`,
      sessionId: session.id,
      membershipId: plan.id,
      memberMembershipId: null,
      paymentReference: `OTHER-${session.id}-${i}`,
      bookingStatus: "CONFIRMED",
    });
  }
}

const row = (id: string) => fake.get("memberMembership", id);

const declaration = { accepted: true };

/** Same calculation the service uses for "monthly" plans. */
function oneMonthAfter(date: Date) {
  const expected = new Date(date);
  expected.setMonth(expected.getMonth() + 1);
  return expected;
}

beforeEach(() => {
  fake.reset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(PAYMENT_DATE);
  fake.insert("user", {
    id: USER_ID,
    fullName: "Test Member",
    email: "member@example.com",
    phone: "08000000000",
  });
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------

describe("bookMemberSession: first booking for a membership-only purchase", () => {
  it("A: starts the membership on the first session date and uses one credit", async () => {
    const plan = addPlan("GROUP");
    const awaiting = addAwaitingMembership(plan);
    const session = addSession(FIRST_SESSION_DATE);

    const before = await bookingService.getMembershipCreditSummary(USER_ID);
    expect(before?.requiresInitialBooking).toBe(true);
    expect(row(awaiting.id).startDate).toBeNull();
    expect(row(awaiting.id).expiryDate).toBeNull();

    const booking = await bookingService.bookMemberSession(
      USER_ID,
      session.id,
      declaration,
      "GROUP"
    );

    expect(booking.bookingStatus).toBe("CONFIRMED");
    expect(booking.memberMembershipId).toBe(awaiting.id);

    const updated = row(awaiting.id);
    expect(updated.startDate).toEqual(FIRST_SESSION_DATE);
    expect(updated.expiryDate).toEqual(oneMonthAfter(FIRST_SESSION_DATE));
    expect(updated.creditsUsed).toBe(1);

    const after = await bookingService.getMembershipCreditSummary(USER_ID);
    expect(after?.requiresInitialBooking).toBe(false);
  });

  it("uses the future first-session date, not the payment date, for validity", async () => {
    const plan = addPlan("GROUP");
    const awaiting = addAwaitingMembership(plan);
    const session = addSession(FIRST_SESSION_DATE);

    await bookingService.bookMemberSession(USER_ID, session.id, declaration, "GROUP");

    const updated = row(awaiting.id);
    // Paid October 24; first class November 3.
    expect(updated.startDate).toEqual(FIRST_SESSION_DATE);
    expect(updated.startDate).not.toEqual(PAYMENT_DATE);
    expect(updated.expiryDate).toEqual(oneMonthAfter(FIRST_SESSION_DATE));
    expect(updated.expiryDate).not.toEqual(oneMonthAfter(PAYMENT_DATE));
  });

  it("B: uses the awaiting membership before an older membership with credits", async () => {
    const plan = addPlan("GROUP");
    const older = addStartedMembership(plan);
    const awaiting = addAwaitingMembership(plan);
    const session = addSession(FIRST_SESSION_DATE);

    const booking = await bookingService.bookMemberSession(
      USER_ID,
      session.id,
      declaration,
      "GROUP"
    );

    expect(booking.memberMembershipId).toBe(awaiting.id);
    expect(row(awaiting.id).startDate).toEqual(FIRST_SESSION_DATE);
    expect(row(awaiting.id).creditsUsed).toBe(1);

    // The older membership is untouched.
    expect(row(older.id).creditsUsed).toBe(2);
    expect(row(older.id).startDate).toEqual(new Date("2026-10-01T00:00:00.000Z"));
    expect(row(older.id).expiryDate).toEqual(new Date("2026-11-30T00:00:00.000Z"));

    const summary = await bookingService.getMembershipCreditSummary(USER_ID);
    expect(summary?.requiresInitialBooking).toBe(false);
  });

  it("C: an existing member with no awaiting membership books as before", async () => {
    const plan = addPlan("GROUP");
    const soonest = addStartedMembership(plan);
    const later = addStartedMembership(plan, {
      expiryDate: new Date("2027-01-31T00:00:00.000Z"),
      creditsUsed: 0,
    });
    const session = addSession(FIRST_SESSION_DATE);

    const booking = await bookingService.bookMemberSession(
      USER_ID,
      session.id,
      declaration,
      "GROUP"
    );

    // Earliest-expiring row with credit, as before.
    expect(booking.memberMembershipId).toBe(soonest.id);
    expect(row(soonest.id).creditsUsed).toBe(3);
    expect(row(later.id).creditsUsed).toBe(0);

    // Dates on a running membership are not changed.
    expect(row(soonest.id).startDate).toEqual(new Date("2026-10-01T00:00:00.000Z"));
    expect(row(soonest.id).expiryDate).toEqual(new Date("2026-11-30T00:00:00.000Z"));

    const summary = await bookingService.getMembershipCreditSummary(USER_ID);
    expect(summary?.requiresInitialBooking).toBe(false);
  });

  describe("D: GROUP and PRIVATE stay separate", () => {
    it("a GROUP booking never uses an awaiting PRIVATE membership", async () => {
      const groupPlan = addPlan("GROUP");
      const privatePlan = addPlan("PRIVATE");
      const group = addStartedMembership(groupPlan);
      const awaitingPrivate = addAwaitingMembership(privatePlan);
      const session = addSession(FIRST_SESSION_DATE);

      const booking = await bookingService.bookMemberSession(
        USER_ID,
        session.id,
        declaration,
        "GROUP"
      );

      expect(booking.memberMembershipId).toBe(group.id);
      expect(row(group.id).creditsUsed).toBe(3);
      expect(row(awaitingPrivate.id).startDate).toBeNull();
      expect(row(awaitingPrivate.id).creditsUsed).toBe(0);

      const summary = await bookingService.getMembershipCreditSummary(USER_ID);
      expect(summary?.requiresInitialBooking).toBe(true);
      expect(summary?.creditPools.PRIVATE?.requiresInitialBooking).toBe(true);
      expect(summary?.creditPools.GROUP?.requiresInitialBooking).toBe(false);
    });

    it("a PRIVATE booking starts an awaiting PRIVATE membership", async () => {
      const groupPlan = addPlan("GROUP");
      const privatePlan = addPlan("PRIVATE");
      const awaitingGroup = addAwaitingMembership(groupPlan);
      const awaitingPrivate = addAwaitingMembership(privatePlan);
      const session = addSession(FIRST_SESSION_DATE);

      const booking = await bookingService.bookMemberSession(
        USER_ID,
        session.id,
        declaration,
        "PRIVATE"
      );

      expect(booking.memberMembershipId).toBe(awaitingPrivate.id);
      expect(row(awaitingPrivate.id).startDate).toEqual(FIRST_SESSION_DATE);
      expect(row(awaitingPrivate.id).creditsUsed).toBe(1);
      expect(row(awaitingGroup.id).startDate).toBeNull();
      expect(row(awaitingGroup.id).creditsUsed).toBe(0);
    });

    it("rejects a PRIVATE booking when only a GROUP membership is awaiting", async () => {
      const groupPlan = addPlan("GROUP");
      const awaitingGroup = addAwaitingMembership(groupPlan);
      const session = addSession(FIRST_SESSION_DATE);

      await expect(
        bookingService.bookMemberSession(USER_ID, session.id, declaration, "PRIVATE")
      ).rejects.toThrow("You do not have an active private membership.");

      expect(row(awaitingGroup.id).startDate).toBeNull();
      expect(store.bookings).toHaveLength(0);
    });

    it("keeps expiry null for a private package, but still records the start date", async () => {
      const packagePlan = addPlan("PRIVATE", {
        duration: "package",
        period: "per package",
        classLimit: 5,
      });
      const awaiting = addAwaitingMembership(packagePlan);
      const session = addSession(FIRST_SESSION_DATE);

      await bookingService.bookMemberSession(USER_ID, session.id, declaration, "PRIVATE");

      expect(row(awaiting.id).startDate).toEqual(FIRST_SESSION_DATE);
      expect(row(awaiting.id).expiryDate).toBeNull();
      expect(row(awaiting.id).creditsUsed).toBe(1);

      const summary = await bookingService.getMembershipCreditSummary(USER_ID);
      expect(summary?.requiresInitialBooking).toBe(false);
    });
  });

  describe("E: an invalid booking changes nothing", () => {
    async function expectNoChange(
      sessionId: string,
      awaitingId: string,
      message: string
    ) {
      const bookingsBefore = store.bookings.length;

      await expect(
        bookingService.bookMemberSession(USER_ID, sessionId, declaration, "GROUP")
      ).rejects.toThrow(message);

      expect(row(awaitingId).startDate).toBeNull();
      expect(row(awaitingId).expiryDate).toBeNull();
      expect(row(awaitingId).creditsUsed).toBe(0);
      expect(store.bookings).toHaveLength(bookingsBefore);
      expect(store.healthForms).toHaveLength(0);

      const summary = await bookingService.getMembershipCreditSummary(USER_ID);
      expect(summary?.requiresInitialBooking).toBe(true);
    }

    it("full group session", async () => {
      const plan = addPlan("GROUP");
      const awaiting = addAwaitingMembership(plan);
      const session = addSession(FIRST_SESSION_DATE);
      fillGroupSession(session, plan, 5);

      await expectNoChange(session.id, awaiting.id, "This group session is full.");
    });

    it("session that is not open", async () => {
      const plan = addPlan("GROUP");
      const awaiting = addAwaitingMembership(plan);
      const session = addSession(FIRST_SESSION_DATE, { status: "CANCELLED" });

      await expectNoChange(
        session.id,
        awaiting.id,
        "This class session is no longer available."
      );
    });

    it("inactive schedule", async () => {
      const plan = addPlan("GROUP");
      const awaiting = addAwaitingMembership(plan);
      const session = addSession(FIRST_SESSION_DATE, { isActive: false });

      await expectNoChange(
        session.id,
        awaiting.id,
        "This class schedule is no longer active."
      );
    });

    it("session less than two hours away", async () => {
      const plan = addPlan("GROUP");
      const awaiting = addAwaitingMembership(plan);
      // 10:00 Lagos = 09:00 UTC on the same day as "now" (09:00 UTC).
      const session = addSession(new Date("2026-10-24T00:00:00.000Z"), {
        startTime: "10:00",
      });

      await expectNoChange(
        session.id,
        awaiting.id,
        "This session must start at least two hours from now."
      );
    });

    it("health declaration not accepted", async () => {
      const plan = addPlan("GROUP");
      const awaiting = addAwaitingMembership(plan);
      const session = addSession(FIRST_SESSION_DATE);

      await expect(
        bookingService.bookMemberSession(
          USER_ID,
          session.id,
          { accepted: false },
          "GROUP"
        )
      ).rejects.toThrow("You must accept the Health Declaration to continue.");

      expect(row(awaiting.id).startDate).toBeNull();
      expect(row(awaiting.id).creditsUsed).toBe(0);
      expect(store.bookings).toHaveLength(0);
    });

    it("rolls back the booking if another request starts the membership first", async () => {
      const plan = addPlan("GROUP");
      const awaiting = addAwaitingMembership(plan);
      const session = addSession(FIRST_SESSION_DATE);

      // Another booking set startDate first, so the guarded update
      // matches no rows.
      fakePrisma.memberMembership.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(
        bookingService.bookMemberSession(USER_ID, session.id, declaration, "GROUP")
      ).rejects.toThrow("Your membership was updated by another booking.");

      expect(store.bookings).toHaveLength(0);
      expect(store.healthForms).toHaveLength(0);
      expect(row(awaiting.id).creditsUsed).toBe(0);
      expect(row(awaiting.id).startDate).toBeNull();
    });
  });

  it("F: later bookings use normal credit deduction and keep the original start date", async () => {
    const plan = addPlan("GROUP");
    const awaiting = addAwaitingMembership(plan);
    const first = addSession(FIRST_SESSION_DATE);
    const second = addSession(SECOND_SESSION_DATE);

    await bookingService.bookMemberSession(USER_ID, first.id, declaration, "GROUP");
    const updateManyCalls = fakePrisma.memberMembership.updateMany.mock.calls.length;

    const booking = await bookingService.bookMemberSession(
      USER_ID,
      second.id,
      declaration,
      "GROUP"
    );

    expect(booking.memberMembershipId).toBe(awaiting.id);
    expect(row(awaiting.id).creditsUsed).toBe(2);
    // Not restarted from the second session.
    expect(row(awaiting.id).startDate).toEqual(FIRST_SESSION_DATE);
    expect(row(awaiting.id).expiryDate).toEqual(oneMonthAfter(FIRST_SESSION_DATE));
    // The second booking took the normal path, not the activation path.
    expect(fakePrisma.memberMembership.updateMany.mock.calls.length).toBe(
      updateManyCalls
    );

    const summary = await bookingService.getMembershipCreditSummary(USER_ID);
    expect(summary?.requiresInitialBooking).toBe(false);
  });

  it("stays out of initial booking after the first booking is cancelled", async () => {
    const plan = addPlan("GROUP");
    const awaiting = addAwaitingMembership(plan);
    const session = addSession(FIRST_SESSION_DATE);

    const booking = await bookingService.bookMemberSession(
      USER_ID,
      session.id,
      declaration,
      "GROUP"
    );

    // The booking moves to another existing status.
    store.bookings.find((b) => b.id === booking.id)!.bookingStatus = "CANCELLED";

    const summary = await bookingService.getMembershipCreditSummary(USER_ID);
    expect(row(awaiting.id).startDate).toEqual(FIRST_SESSION_DATE);
    expect(summary?.requiresInitialBooking).toBe(false);
  });

  it("does not treat an already-booked legacy row with no start date as awaiting", async () => {
    // A row booked before this fix: NEW, no first session, dates still
    // null, but it already has a confirmed booking.
    const plan = addPlan("GROUP");
    const legacy = addAwaitingMembership(plan, { creditsUsed: 1 });
    const pastSession = addSession(new Date("2026-10-20T00:00:00.000Z"));
    store.bookings.push({
      id: "legacy_booking",
      userId: USER_ID,
      sessionId: pastSession.id,
      membershipId: plan.id,
      memberMembershipId: legacy.id,
      bookingStatus: "CONFIRMED",
    });
    const session = addSession(FIRST_SESSION_DATE);

    const summary = await bookingService.getMembershipCreditSummary(USER_ID);
    expect(summary?.requiresInitialBooking).toBe(false);

    await bookingService.bookMemberSession(USER_ID, session.id, declaration, "GROUP");

    // Normal deduction; this fix doesn't backfill dates on that row.
    expect(row(legacy.id).creditsUsed).toBe(2);
    expect(row(legacy.id).startDate).toBeNull();
  });
});
