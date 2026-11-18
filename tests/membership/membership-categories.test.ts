/**
 * GROUP and PRIVATE are separate membership categories.
 *
 * - Upgrades stay within one category (same-category upgrade keeps the
 *   existing credit carry-over; cross-category is rejected).
 * - Moving to the other category is a NEW purchase; nothing carries over.
 * - A member can hold both. Renewing one never touches the other, and
 *   each keeps its own credits and expiry.
 * - The credits summary returns each membership record separately.
 *
 * Real initiateUpgrade / initiateRenewal / initiateNewMembershipPurchase
 * and completeMembershipPurchase; Prisma is the in-memory fake.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePrisma, type Row } from "../helpers/fake-prisma";

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

const { default: membershipService } = await import("../../src/membership/membership.service.js");
const { default: bookingService } = await import("../../src/booking/booking.service.js");

const USER_ID = "user_1";
const OTHER_ID = "user_2";
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function addMonths(date: Date, months: number) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
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

function tick() {
  vi.setSystemTime(new Date(Date.now() + 60_000));
}

function rowForReference(reference: string) {
  const purchase = fake.tables.membershipPurchase.find((item) => item.paymentReference === reference)!;
  return fake.tables.memberMembership.find((item) => item.membershipPurchaseId === purchase.id)!;
}

async function renew(membershipId?: string, memberMembershipId?: string) {
  tick();
  const result = await membershipService.initiateRenewal(USER_ID, membershipId, memberMembershipId);
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
const snapshot = (id: string) => ({ ...row(id) });

beforeEach(() => {
  fake.reset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(d("2026-11-15"));

  plans = {};
  addPlan("monthly", { type: "GROUP", duration: "Monthly", period: "/month", classLimit: 8 });
  addPlan("twoMonth", { type: "GROUP", duration: "2 Months", period: "/2 months", classLimit: 16 });
  addPlan("privateMonthly", { type: "PRIVATE", duration: "Monthly", period: "/month", classLimit: 4 });
  addPlan("privatePlus", { type: "PRIVATE", duration: "2 Months", period: "/2 months", classLimit: 10 });

  fake.insert("user", { id: USER_ID, fullName: "Test Member", email: "member@example.com", phone: "08000000000" });
  fake.insert("user", { id: OTHER_ID, fullName: "Other", email: "other@example.com", phone: "08000000009" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("upgrade stays within one category", () => {
  it("GROUP → GROUP: succeeds with the existing credit carry-over (unchanged)", async () => {
    const current = addStarted(plans.monthly, { creditsUsed: 3 });

    const { row: upgraded, carriedCredits, newCreditsTotal } = await upgrade(plans.twoMonth.id);

    // Same rule as before: 16 new + 5 unused carried + 3 used kept.
    expect(carriedCredits).toBe(5);
    expect(newCreditsTotal).toBe(24);
    expect(upgraded).toMatchObject({ creditsTotal: 24, creditsUsed: 3, status: "ACTIVE" });
    expect(upgraded.expiryDate).toEqual(addMonths(d("2026-12-01"), 2));
    expect(row(current.id).status).toBe("EXPIRED");
  });

  it("PRIVATE → PRIVATE: succeeds", async () => {
    const current = addStarted(plans.privateMonthly, { creditsUsed: 1 });

    const { row: upgraded, carriedCredits } = await upgrade(plans.privatePlus.id);

    expect(carriedCredits).toBe(3);
    expect(upgraded).toMatchObject({ membershipId: plans.privatePlus.id, creditsTotal: 10 + 3 + 1, creditsUsed: 1 });
    expect(row(current.id).status).toBe("EXPIRED");
  });

  it("GROUP → PRIVATE and PRIVATE → GROUP are rejected; nothing is created or changed", async () => {
    const group = addStarted(plans.monthly, { creditsUsed: 2 });
    const before = snapshot(group.id);

    await expect(membershipService.initiateUpgrade(USER_ID, plans.privateMonthly.id)).rejects.toThrow(
      /Group and Private are separate memberships.*purchase this plan as a new membership/
    );
    expect(fake.tables.membershipPurchase).toHaveLength(0);
    expect(row(group.id)).toEqual(before);

    fake.reset();
    plans = {};
    addPlan("monthly", { type: "GROUP", duration: "Monthly", period: "/month", classLimit: 8 });
    addPlan("privateMonthly", { type: "PRIVATE", duration: "Monthly", period: "/month", classLimit: 4 });
    fake.insert("user", { id: USER_ID, fullName: "Test Member", email: "member@example.com" });
    addStarted(plans.privateMonthly);

    await expect(membershipService.initiateUpgrade(USER_ID, plans.monthly.id)).rejects.toThrow(
      /don't have a Group membership to upgrade/
    );
    expect(fake.tables.membershipPurchase).toHaveLength(0);
  });

  it("holding both: a GROUP upgrade replaces only GROUP, even when PRIVATE expires first", async () => {
    // Before this fix the earliest-expiring membership of ANY type was
    // upgraded, so PRIVATE would have been replaced and its credits moved.
    const privateRow = addStarted(plans.privateMonthly, { expiryDate: d("2026-11-20"), creditsUsed: 1 });
    const group = addStarted(plans.monthly, { creditsUsed: 3 });
    const privateBefore = snapshot(privateRow.id);

    const { row: upgraded, carriedCredits } = await upgrade(plans.twoMonth.id);

    expect(carriedCredits).toBe(5); // GROUP credits only (8 - 3)
    expect(upgraded.creditsTotal).toBe(16 + 5 + 3);
    expect(row(group.id).status).toBe("EXPIRED");
    expect(row(privateRow.id)).toEqual(privateBefore);
  });

  it("no membership at all: the existing message", async () => {
    await expect(membershipService.initiateUpgrade(USER_ID, plans.twoMonth.id)).rejects.toThrow(
      "No previous membership found. Please purchase a new membership first."
    );
  });
});

describe("cross-category selection is a new purchase", () => {
  it("a GROUP member buying PRIVATE gets a separate membership; GROUP and its credits are untouched", async () => {
    const group = addStarted(plans.monthly, { creditsUsed: 3 });
    const groupBefore = snapshot(group.id);

    tick();
    const started = await membershipService.initiateNewMembershipPurchase({
      membershipId: plans.privateMonthly.id,
      fullName: "Test Member",
      email: "member@example.com",
      phone: "08000000000",
      userId: USER_ID,
    });
    await membershipService.completeMembershipPurchase(started.reference);

    const purchase = fake.tables.membershipPurchase.find((item) => item.paymentReference === started.reference)!;
    expect(purchase.type).toBe("NEW");
    expect(purchase.carriedCredits ?? 0).toBe(0);
    const privateRow = rowForReference(started.reference);
    // Its own allowance only: no GROUP credits carried in.
    expect(privateRow).toMatchObject({ membershipId: plans.privateMonthly.id, creditsTotal: 4, creditsUsed: 0, status: "ACTIVE" });
    expect(row(group.id)).toEqual(groupBefore);
  });
});

describe("holding GROUP and PRIVATE together", () => {
  let group: Row;
  let privateRow: Row;

  beforeEach(() => {
    group = addStarted(plans.monthly, { creditsUsed: 3, expiryDate: d("2026-12-01") });
    privateRow = addStarted(plans.privateMonthly, { creditsUsed: 1, expiryDate: d("2026-12-10") });
  });

  it("renewing GROUP adds a GROUP membership after GROUP's expiry and leaves PRIVATE alone", async () => {
    const privateBefore = snapshot(privateRow.id);

    const { row: renewed } = await renew(plans.monthly.id);

    expect(renewed).toMatchObject({ membershipId: plans.monthly.id, creditsTotal: 8, creditsUsed: 0 });
    expect(renewed.startDate).toEqual(d("2026-12-01"));
    expect(renewed.expiryDate).toEqual(addMonths(d("2026-12-01"), 1));
    expect(row(privateRow.id)).toEqual(privateBefore);
    expect(row(group.id).status).toBe("ACTIVE");
  });

  it("renewing PRIVATE (by its record ID) adds a PRIVATE membership and leaves GROUP alone", async () => {
    const groupBefore = snapshot(group.id);

    const { row: renewed } = await renew(undefined, privateRow.id);

    expect(renewed).toMatchObject({ membershipId: plans.privateMonthly.id, creditsTotal: 4, creditsUsed: 0 });
    expect(renewed.startDate).toEqual(d("2026-12-10"));
    expect(renewed.expiryDate).toEqual(addMonths(d("2026-12-10"), 1));
    expect(row(group.id)).toEqual(groupBefore);
  });

  it("a renewal without a plan or record is ambiguous and is refused, not guessed", async () => {
    await expect(membershipService.initiateRenewal(USER_ID)).rejects.toThrow(
      "You have both a Group and a Private membership. Please choose which membership to renew."
    );
    expect(fake.tables.membershipPurchase).toHaveLength(0);
  });

  it("a record ID with a plan of the other category is refused", async () => {
    await expect(
      membershipService.initiateRenewal(USER_ID, plans.monthly.id, privateRow.id)
    ).rejects.toThrow(/A renewal must use a plan of the same type/);
    expect(fake.tables.membershipPurchase).toHaveLength(0);
  });

  it("another member's record ID is not found", async () => {
    const theirs = fake.insert("memberMembership", {
      userId: OTHER_ID,
      membershipId: plans.monthly.id,
      status: "ACTIVE",
      creditsTotal: 8,
      creditsUsed: 0,
    });
    await expect(membershipService.initiateRenewal(USER_ID, undefined, theirs.id)).rejects.toThrow(
      "Membership to renew was not found."
    );
  });

  it("credits summary: each membership separately, with its own record ID, plan, credits and dates", async () => {
    const summary = (await bookingService.getMembershipCreditSummary(USER_ID))!;

    const byType = Object.fromEntries(summary.memberships.map((item) => [item.type, item]));
    expect(summary.memberships).toHaveLength(2);
    expect(byType.GROUP).toMatchObject({
      memberMembershipId: group.id,
      membershipId: plans.monthly.id,
      status: "ACTIVE",
      startDate: d("2026-11-01"),
      expiryDate: d("2026-12-01"),
      creditsTotal: 8,
      creditsUsed: 3,
      remainingCredits: 5,
      unlimited: false,
      queued: false,
      plan: expect.objectContaining({ id: plans.monthly.id, type: "GROUP", name: "monthly" }),
    });
    expect(byType.PRIVATE).toMatchObject({
      memberMembershipId: privateRow.id,
      membershipId: plans.privateMonthly.id,
      expiryDate: d("2026-12-10"),
      creditsTotal: 4,
      creditsUsed: 1,
      remainingCredits: 3,
    });
    // The record ID is not the plan ID.
    expect(byType.GROUP.memberMembershipId).not.toBe(byType.GROUP.membershipId);

    // Pools stay separate; legacy top-level fields are kept as before.
    expect(summary.creditPools.GROUP).toMatchObject({ remainingCredits: 5, expiryDate: d("2026-12-01") });
    expect(summary.creditPools.PRIVATE).toMatchObject({ remainingCredits: 3, expiryDate: d("2026-12-10") });
    expect(summary).toMatchObject({ memberMembershipId: group.id, creditsTotal: 12, remainingCredits: 8 });
  });

  it("booking a GROUP class uses GROUP credits only; PRIVATE is unchanged", async () => {
    const schedule = fake.insert("schedule", {
      className: "Reformer", tutorName: "Tutor", code: "REF", dayOfWeek: "FRIDAY",
      startTime: "10:00", endTime: "11:00", capacity: 5, isActive: true,
    });
    const session = fake.insert("classSession", { scheduleId: schedule.id, sessionDate: d("2026-11-20"), status: "OPEN" });
    const privateBefore = snapshot(privateRow.id);

    await bookingService.bookMemberSession(USER_ID, session.id, { accepted: true }, "GROUP");

    expect(row(group.id).creditsUsed).toBe(4);
    expect(row(privateRow.id)).toEqual(privateBefore);
  });
});
