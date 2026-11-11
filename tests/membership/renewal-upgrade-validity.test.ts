/**
 * Renewal and upgrade validity rules.
 *
 * - Started, unexpired membership: new expiry = existing expiry + the
 *   new package's full duration. Remaining days are never lost.
 * - Expired membership: expired days are not kept; the new membership
 *   waits for its first booking.
 * - Unstarted membership (dates null): the renewal or upgrade also
 *   waits. The first booking starts it, keeping the full value of
 *   every package bought.
 * - The payment date is never used as a start date.
 * - Upgrades keep the existing credit rule (unused credits carried,
 *   usage kept), carry each row's credits once, and leave no
 *   replaced membership ACTIVE.
 *
 * Purchases go through the real initiateRenewal / initiateUpgrade and
 * completeMembershipPurchase. First bookings go through the real
 * bookMemberSession. Prisma is the in-memory fake in tests/helpers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePrisma, type Row } from "../helpers/fake-prisma";

const fake = createFakePrisma();

vi.mock("../../src/config/prisma.js", () => ({ default: fake.prisma }));

vi.mock("../../src/payment/payment.service.js", () => ({
  default: {
    initializeTransaction: vi.fn(async ({ reference }: { reference: string }) => ({
      status: true,
      data: {
        authorization_url: `https://pay.test/${reference}`,
        reference,
      },
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

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------

const USER_ID = "user_1";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Calendar-month arithmetic, the same way the service does it. */
function addMonths(date: Date, months: number) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

function addYears(date: Date, years: number) {
  const result = new Date(date);
  result.setFullYear(result.getFullYear() + years);
  return result;
}

let plans: Record<string, Row>;

function addPlan(key: string, data: Row) {
  plans[key] = fake.insert("membership", {
    name: key,
    slug: key,
    price: 50000,
    isActive: true,
    features: [],
    ...data,
  });
}

/** A membership that has started (no purchase record). */
function addStarted(plan: Row, overrides: Row = {}) {
  return fake.insert("memberMembership", {
    userId: USER_ID,
    membershipId: plan.id,
    status: "ACTIVE",
    startDate: d("2026-11-01"),
    expiryDate: d("2026-12-01"),
    creditsTotal: plan.classLimit,
    creditsUsed: 0,
    ...overrides,
  });
}

/** A NEW membership-only purchase that has not had its first booking. */
function addUnstarted(plan: Row) {
  const purchase = fake.insert("membershipPurchase", {
    userId: USER_ID,
    email: "member@example.com",
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
    startDate: null,
    expiryDate: null,
    creditsTotal: plan.classLimit,
    creditsUsed: 0,
  });
}

/** Move the clock forward so each purchase gets a unique reference. */
function tick() {
  vi.setSystemTime(new Date(Date.now() + 60_000));
}

function rowForReference(reference: string) {
  const purchase = fake.tables.membershipPurchase.find(
    (item) => item.paymentReference === reference
  )!;
  return fake.tables.memberMembership.find(
    (item) => item.membershipPurchaseId === purchase.id
  )!;
}

function purchaseForReference(reference: string) {
  return fake.tables.membershipPurchase.find(
    (item) => item.paymentReference === reference
  )!;
}

async function renew(membershipId?: string) {
  tick();
  const result = await membershipService.initiateRenewal(USER_ID, membershipId);
  await membershipService.completeMembershipPurchase(result.reference);
  return { ...result, row: rowForReference(result.reference) };
}

async function upgrade(membershipId: string) {
  tick();
  const result = await membershipService.initiateUpgrade(USER_ID, membershipId);
  await membershipService.completeMembershipPurchase(result.reference);
  return { ...result, row: rowForReference(result.reference) };
}

const row = (id: string) => fake.get("memberMembership", id);

const activeRows = () =>
  fake.tables.memberMembership.filter(
    (item) => item.userId === USER_ID && item.status === "ACTIVE"
  );

function addSession(sessionDate: Date) {
  const schedule = fake.insert("schedule", {
    className: "Reformer",
    tutorName: "Tutor",
    code: "REF",
    dayOfWeek: "FRIDAY",
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

async function bookFirstSession(sessionDate: Date, type: "GROUP" | "PRIVATE" = "GROUP") {
  const session = addSession(sessionDate);
  return bookingService.bookMemberSession(
    USER_ID,
    session.id,
    { accepted: true },
    type
  );
}

const requiresInitialBooking = async () =>
  (await bookingService.getMembershipCreditSummary(USER_ID))?.requiresInitialBooking;

beforeEach(() => {
  fake.reset();
  vi.useFakeTimers({ toFake: ["Date"] });

  plans = {};
  addPlan("monthly", { type: "GROUP", duration: "Monthly", period: "/month", classLimit: 8 });
  addPlan("twoMonth", { type: "GROUP", duration: "2 Months", period: "/2 months", classLimit: 16 });
  addPlan("quarterly", { type: "GROUP", duration: "Quarterly", period: "3 months", classLimit: 24 });
  addPlan("annual", { type: "GROUP", duration: "Annual", period: "/year", classLimit: 120 });
  addPlan("privateMonthly", { type: "PRIVATE", duration: "Monthly", period: "/month", classLimit: 4 });

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
// Renewal
// ---------------------------------------------------------------------

describe("renewal", () => {
  it("early renewal keeps the remaining days and adds the full new duration", async () => {
    vi.setSystemTime(d("2026-11-08")); // 23 days before the Dec 1 expiry
    const current = addStarted(plans.monthly, { creditsUsed: 3 });

    const { row: renewed, reference } = await renew();

    expect(renewed.startDate).toEqual(d("2026-12-01"));
    expect(renewed.expiryDate).toEqual(addMonths(d("2026-12-01"), 1));
    // Not counted from the renewal payment date.
    expect(renewed.expiryDate).not.toEqual(addMonths(d("2026-11-08"), 1));

    // The current membership keeps running, with its credits.
    expect(row(current.id).status).toBe("ACTIVE");
    expect(row(current.id).expiryDate).toEqual(d("2026-12-01"));
    expect(row(current.id).creditsUsed).toBe(3);

    // The renewal has its own fresh credits.
    expect(renewed.creditsTotal).toBe(8);
    expect(renewed.creditsUsed).toBe(0);
    expect(purchaseForReference(reference).previousMemberMembershipId).toBe(current.id);
  });

  it("multiple consecutive renewals each add their duration exactly once", async () => {
    vi.setSystemTime(d("2026-11-08"));
    addStarted(plans.monthly);

    const first = await renew();
    const second = await renew();
    const third = await renew();

    expect([first.row.startDate, first.row.expiryDate]).toEqual([
      d("2026-12-01"),
      addMonths(d("2026-12-01"), 1),
    ]);
    expect([second.row.startDate, second.row.expiryDate]).toEqual([
      first.row.expiryDate,
      addMonths(first.row.expiryDate, 1),
    ]);
    expect([third.row.startDate, third.row.expiryDate]).toEqual([
      second.row.expiryDate,
      addMonths(second.row.expiryDate, 1),
    ]);
    expect(third.row.expiryDate).toEqual(addMonths(d("2026-12-01"), 3));
    expect(activeRows()).toHaveLength(4);
  });

  it("completing the same renewal twice does not add its duration again", async () => {
    vi.setSystemTime(d("2026-11-08"));
    addStarted(plans.monthly);

    const { reference, row: renewed } = await renew();
    await membershipService.completeMembershipPurchase(reference);

    expect(row(renewed.id).expiryDate).toEqual(addMonths(d("2026-12-01"), 1));
    expect(activeRows()).toHaveLength(2);
  });

  it("renews plans the old expiry calculation rejected (Annual)", async () => {
    vi.setSystemTime(d("2026-11-08"));
    addStarted(plans.annual);

    const { row: renewed } = await renew();

    expect(renewed.startDate).toEqual(d("2026-12-01"));
    expect(renewed.expiryDate).toEqual(addYears(d("2026-12-01"), 1));
  });

  it("an expired membership adds no expired days; the renewal waits for its first booking", async () => {
    vi.setSystemTime(d("2026-11-08"));
    const expired = addStarted(plans.monthly, {
      startDate: d("2026-10-01"),
      expiryDate: d("2026-11-01"),
      creditsUsed: 5,
    });

    const { row: renewed } = await renew();

    expect(renewed.startDate).toBeNull();
    expect(renewed.expiryDate).toBeNull();
    expect(row(expired.id).status).toBe("EXPIRED");
    expect(await requiresInitialBooking()).toBe(true);

    await bookFirstSession(d("2026-11-20"));

    expect(row(renewed.id).startDate).toEqual(d("2026-11-20"));
    expect(row(renewed.id).expiryDate).toEqual(addMonths(d("2026-11-20"), 1));
    expect(row(renewed.id).creditsUsed).toBe(1);
    expect(row(expired.id).creditsUsed).toBe(5);
    expect(await requiresInitialBooking()).toBe(false);
  });

  it("renewals of an unstarted membership wait, then follow it at the first booking", async () => {
    vi.setSystemTime(d("2026-11-08"));
    const original = addUnstarted(plans.monthly);

    const first = await renew();
    const second = await renew();

    for (const item of [original, first.row, second.row]) {
      expect(row(item.id).startDate).toBeNull();
      expect(row(item.id).expiryDate).toBeNull();
    }
    expect(await requiresInitialBooking()).toBe(true);

    const booking = await bookFirstSession(d("2026-11-20"));

    // The first booking is charged to the original package.
    expect(booking.memberMembershipId).toBe(original.id);
    expect(row(original.id).creditsUsed).toBe(1);

    // Original first, then each renewal straight after it.
    expect(row(original.id).startDate).toEqual(d("2026-11-20"));
    expect(row(original.id).expiryDate).toEqual(addMonths(d("2026-11-20"), 1));
    expect(row(first.row.id).startDate).toEqual(addMonths(d("2026-11-20"), 1));
    expect(row(first.row.id).expiryDate).toEqual(addMonths(d("2026-11-20"), 2));
    expect(row(second.row.id).startDate).toEqual(addMonths(d("2026-11-20"), 2));
    expect(row(second.row.id).expiryDate).toEqual(addMonths(d("2026-11-20"), 3));
    expect(row(first.row.id).creditsUsed).toBe(0);
    expect(row(second.row.id).creditsUsed).toBe(0);

    expect(await requiresInitialBooking()).toBe(false);
  });

  it("does not borrow validity from a membership of the other type", async () => {
    vi.setSystemTime(d("2026-11-08"));
    const group = addStarted(plans.monthly);

    const { row: renewed } = await renew(plans.privateMonthly.id);

    expect(renewed.startDate).toBeNull();
    expect(renewed.expiryDate).toBeNull();
    expect(row(group.id).status).toBe("ACTIVE");
  });
});

// ---------------------------------------------------------------------
// Upgrade
// ---------------------------------------------------------------------

describe("upgrade", () => {
  it("early upgrade keeps the remaining days, adds the full upgraded duration and carries credits", async () => {
    vi.setSystemTime(d("2026-11-15"));
    const current = addStarted(plans.monthly, { creditsUsed: 3 });

    const { row: upgraded, reference, carriedCredits, newCreditsTotal } =
      await upgrade(plans.twoMonth.id);

    expect(upgraded.expiryDate).toEqual(addMonths(d("2026-12-01"), 2));
    expect(upgraded.expiryDate).not.toEqual(addMonths(d("2026-11-15"), 2));
    // Validity started when the membership did, not at the upgrade.
    expect(upgraded.startDate).toEqual(d("2026-11-01"));

    // Existing rule: 16 new + 5 unused carried + 3 used kept; 3 used.
    expect(upgraded.creditsTotal).toBe(24);
    expect(upgraded.creditsUsed).toBe(3);
    expect(purchaseForReference(reference).carriedCredits).toBe(5);
    expect(carriedCredits).toBe(5);
    expect(newCreditsTotal).toBe(24);

    expect(row(current.id).status).toBe("EXPIRED");
    expect(activeRows().map((item) => item.id)).toEqual([upgraded.id]);
  });

  it("renewal then upgrade: replaces both and adds the duration after the renewal", async () => {
    vi.setSystemTime(d("2026-11-08"));
    const current = addStarted(plans.monthly, { creditsUsed: 3 });
    const { row: renewed } = await renew();

    vi.setSystemTime(d("2026-11-15"));
    const { row: upgraded, carriedCredits, newCreditsTotal } = await upgrade(
      plans.twoMonth.id
    );

    // Paid through Jan 1 (current + renewal), then two more months.
    expect(upgraded.expiryDate).toEqual(addMonths(addMonths(d("2026-12-01"), 1), 2));
    expect(upgraded.startDate).toEqual(d("2026-11-01"));

    // 16 new + (5 + 8) unused carried + 3 used kept.
    expect(upgraded.creditsTotal).toBe(32);
    expect(upgraded.creditsUsed).toBe(3);
    expect(carriedCredits).toBe(13);
    expect(newCreditsTotal).toBe(32);

    expect(row(current.id).status).toBe("EXPIRED");
    expect(row(renewed.id).status).toBe("EXPIRED");
    expect(activeRows().map((item) => item.id)).toEqual([upgraded.id]);
  });

  it("a second upgrade starts from the upgraded membership, not the replaced one", async () => {
    vi.setSystemTime(d("2026-11-15"));
    const original = addStarted(plans.monthly, { creditsUsed: 3 });
    const { row: first } = await upgrade(plans.twoMonth.id);

    const { row: second } = await upgrade(plans.quarterly.id);

    // 24 new + 21 unused from the first upgrade + 3 used kept.
    // The original row's credits are not carried a second time.
    expect(second.creditsTotal).toBe(48);
    expect(second.creditsUsed).toBe(3);
    expect(second.expiryDate).toEqual(addMonths(first.expiryDate, 3));
    expect(second.startDate).toEqual(d("2026-11-01"));

    expect(row(original.id).status).toBe("EXPIRED");
    expect(row(first.id).status).toBe("EXPIRED");
    expect(activeRows().map((item) => item.id)).toEqual([second.id]);
  });

  it("upgrade then renewal: the renewal starts when the upgraded membership ends", async () => {
    vi.setSystemTime(d("2026-11-15"));
    addStarted(plans.monthly);
    const { row: upgraded } = await upgrade(plans.twoMonth.id);

    const { row: renewed } = await renew();

    // Renews the upgraded (two-month) package.
    expect(renewed.membershipId).toBe(plans.twoMonth.id);
    expect(renewed.startDate).toEqual(upgraded.expiryDate);
    expect(renewed.expiryDate).toEqual(addMonths(upgraded.expiryDate, 2));
    expect(row(upgraded.id).status).toBe("ACTIVE");
    expect(activeRows()).toHaveLength(2);
  });

  it("an expired membership adds no expired days or credits; the upgrade waits for its first booking", async () => {
    vi.setSystemTime(d("2026-11-15"));
    const expired = addStarted(plans.monthly, {
      startDate: d("2026-10-01"),
      expiryDate: d("2026-11-01"),
      creditsUsed: 6,
    });

    const { row: upgraded } = await upgrade(plans.twoMonth.id);

    expect(upgraded.startDate).toBeNull();
    expect(upgraded.expiryDate).toBeNull();
    expect(upgraded.creditsTotal).toBe(16);
    expect(upgraded.creditsUsed).toBe(0);
    expect(row(expired.id).status).toBe("EXPIRED");
    expect(await requiresInitialBooking()).toBe(true);

    await bookFirstSession(d("2026-11-20"));

    expect(row(upgraded.id).startDate).toEqual(d("2026-11-20"));
    expect(row(upgraded.id).expiryDate).toEqual(addMonths(d("2026-11-20"), 2));
    expect(row(upgraded.id).creditsUsed).toBe(1);
  });

  it("upgrading an unstarted membership waits, then keeps both packages' durations", async () => {
    vi.setSystemTime(d("2026-11-15"));
    const original = addUnstarted(plans.monthly);

    const { row: upgraded } = await upgrade(plans.twoMonth.id);

    expect(upgraded.startDate).toBeNull();
    expect(upgraded.expiryDate).toBeNull();
    // 16 new + 8 unused carried.
    expect(upgraded.creditsTotal).toBe(24);
    expect(upgraded.creditsUsed).toBe(0);
    expect(row(original.id).status).toBe("EXPIRED");
    expect(activeRows().map((item) => item.id)).toEqual([upgraded.id]);
    expect(await requiresInitialBooking()).toBe(true);

    const booking = await bookFirstSession(d("2026-11-20"));

    expect(booking.memberMembershipId).toBe(upgraded.id);
    expect(row(upgraded.id).startDate).toEqual(d("2026-11-20"));
    // One month (original) + two months (upgrade) from the first class.
    expect(row(upgraded.id).expiryDate).toEqual(
      addMonths(addMonths(d("2026-11-20"), 1), 2)
    );
    expect(row(upgraded.id).creditsUsed).toBe(1);
    // The replaced row is not started or charged.
    expect(row(original.id).startDate).toBeNull();
    expect(row(original.id).creditsUsed).toBe(0);
    expect(await requiresInitialBooking()).toBe(false);
  });

  it("unstarted membership, renewed, then upgraded: the first booking keeps all three durations", async () => {
    vi.setSystemTime(d("2026-11-08"));
    addUnstarted(plans.monthly);
    const { row: renewed } = await renew();

    vi.setSystemTime(d("2026-11-15"));
    const { row: upgraded } = await upgrade(plans.twoMonth.id);

    // 16 new + 8 + 8 unused carried.
    expect(upgraded.creditsTotal).toBe(32);
    expect(row(renewed.id).status).toBe("EXPIRED");
    expect(activeRows().map((item) => item.id)).toEqual([upgraded.id]);

    await bookFirstSession(d("2026-11-20"));

    expect(row(upgraded.id).startDate).toEqual(d("2026-11-20"));
    expect(row(upgraded.id).expiryDate).toEqual(
      addMonths(addMonths(addMonths(d("2026-11-20"), 1), 1), 2)
    );
  });

  it("a later started upgrade does not count an earlier replaced package again", async () => {
    vi.setSystemTime(d("2026-11-15"));
    addUnstarted(plans.monthly);
    const { row: first } = await upgrade(plans.twoMonth.id);
    await bookFirstSession(d("2026-11-20"));
    const firstExpiry = row(first.id).expiryDate;

    const { row: second } = await upgrade(plans.quarterly.id);

    // Started chain: previous expiry + three months, nothing else.
    expect(second.expiryDate).toEqual(addMonths(firstExpiry, 3));
    expect(second.startDate).toEqual(d("2026-11-20"));
  });
});
