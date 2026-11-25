/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed results */
/**
 * Confirming a booking that is linked to an EXISTING membership record
 * (the first class of a purchase, an admin first-class retry, an offline
 * activation) must not reset that record's creditsTotal to the plan's
 * allowance: an admin may have removed credits from it in between.
 *
 * BookingService.confirmGroupBooking / confirmPrivateBooking used to write
 * creditsTotal = plan.classLimit on the existing record.
 *
 * In memory (tests/helpers/fake-prisma), real services throughout, as in
 * offline-membership-activation.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePrisma, type Row } from "../helpers/fake-prisma";

const fake = createFakePrisma();

vi.mock("../../src/config/prisma.js", () => ({ default: fake.prisma }));

vi.mock("../../src/utils/mailer.js", () => ({
  sendPasswordResetEmail: vi.fn(async () => undefined),
  sendVerificationEmail: vi.fn(async () => undefined),
  sendPaymentConfirmationEmail: vi.fn(async () => undefined),
  sendAdminPaymentNotificationEmail: vi.fn(async () => undefined),
}));

vi.mock("../../src/google-calendar/google-calendar.service.js", () => ({
  googleCalendarService: {
    createBookingEvent: vi.fn(async ({ bookingId }: { bookingId: string }) => ({
      eventId: `evt_${bookingId}`,
      eventUrl: `https://calendar.test/${bookingId}`,
    })),
    deleteBookingEvent: vi.fn(async () => undefined),
  },
}));

vi.mock("../../src/payment/payment.service.js", () => ({
  default: {
    initializeTransaction: vi.fn(async ({ reference }: { reference: string }) => ({
      status: true,
      data: { authorization_url: `https://pay.test/${reference}`, reference },
    })),
  },
}));

vi.mock("../../src/admin/admin-notification.service.js", () => ({
  adminNotificationService: {
    createForAllAdmins: vi.fn(async () => ({ created: 0, pushSent: 0 })),
  },
}));

const { adminService } = await import("../../src/admin/admin.service.js");
const { default: membershipService } = await import("../../src/membership/membership.service.js");
const { membershipActivationService } = await import(
  "../../src/membership-activation/membership-activation.service.js"
);
const { adminCreditsService } = await import("../../src/admin/admin-credits.service.js");

const EMAIL = "customer@example.com";
const PURCHASE_TIME = new Date("2026-10-24T09:00:00.000Z");
const CLASS_DATE = new Date("2026-11-03T00:00:00.000Z"); // 10:00 Lagos

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
    code: `REF-${fake.tables.schedule.length + 1}`,
    dayOfWeek: "TUESDAY",
    startTime: "10:00",
    endTime: "11:00",
    capacity: 5,
    isActive: true,
  });
  return fake.insert("classSession", { scheduleId: schedule.id, sessionDate, status: "OPEN" });
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

/**
 * An offline purchase with a first class that could not be booked when
 * the admin confirmed the payment (the session was taken): the membership
 * record is ACTIVE with its full allowance and no credit used yet.
 */
async function purchaseWithFailedFirstClass(plan: Row, blockers: number) {
  const session = addSession(CLASS_DATE);
  const result = await membershipService.initiateOfflineMembershipPurchase({
    membershipId: plan.id,
    fullName: "Offline Customer",
    email: EMAIL,
    phone: "08000000000",
    userId: null,
    firstSessionId: session.id,
    healthDeclarationAccepted: true,
  });
  const others = fillSession(session, plan, blockers);
  const confirmed: any = await adminService.confirmOfflineMembershipPurchase(result.purchaseId);
  expect(confirmed.summary.firstClass).toBe("NOT_CONFIRMED");
  const purchase = fake.get("membershipPurchase", result.purchaseId);
  const membership = fake.tables.memberMembership.find((row) => row.membershipPurchaseId === purchase.id)!;
  // Confirmation creates the customer's account: the record belongs to it.
  expect(membership).toMatchObject({ status: "ACTIVE", creditsTotal: plan.classLimit, creditsUsed: 0 });
  expect(membership.userId).toBeTruthy();
  return { purchase, membership, others, confirmed };
}

const freeSeats = (others: Row[]) => {
  for (const row of others) fake.get("booking", row.id).bookingStatus = "CANCELLED";
};

const retry = (purchaseId: string) => adminService.retryOfflineMembershipFirstBooking(purchaseId) as Promise<any>;

beforeEach(() => {
  fake.reset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(PURCHASE_TIME);
  process.env.RESEND_API_KEY = "test-key";
  process.env.EMAIL_FROM = "noreply@sculpt.test";
  process.env.JWT_ACCESS_SECRET = "test-access-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, text: async () => "", json: async () => ({ id: "email_1" }) })));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
});

describe("confirming a first class keeps credits an admin removed", () => {
  it("GROUP: single-record removal, then the first-class retry", async () => {
    const plan = addPlan({ type: "GROUP", duration: "Monthly", period: "/month", classLimit: 5 });
    const { purchase, membership, others } = await purchaseWithFailedFirstClass(plan, 5);

    // Single-record removal on the purchase's membership record.
    await adminCreditsService.removeCredits({
      memberId: membership.userId,
      memberMembershipId: membership.id,
      credits: 2,
      expectedRemaining: 5,
    });
    expect(fake.get("memberMembership", membership.id).creditsTotal).toBe(3);

    freeSeats(others);
    const result = await retry(purchase.id);

    expect(result.firstClass.status).toBe("CONFIRMED");
    // 3 left after the removal, 1 used by the first class: never back to 5.
    expect(fake.get("memberMembership", membership.id)).toMatchObject({ creditsTotal: 3, creditsUsed: 1, status: "ACTIVE" });
  });

  it("PRIVATE: single-record removal, then the first-class retry", async () => {
    const plan = addPlan({ type: "PRIVATE", duration: "Package", period: "package", classLimit: 5 });
    const { purchase, membership, others } = await purchaseWithFailedFirstClass(plan, 1);

    await adminCreditsService.removeCredits({
      memberId: membership.userId,
      memberMembershipId: membership.id,
      credits: 4,
      expectedRemaining: 5,
    });

    freeSeats(others);
    const result = await retry(purchase.id);

    expect(result.firstClass.status).toBe("CONFIRMED");
    expect(fake.get("memberMembership", membership.id)).toMatchObject({ creditsTotal: 1, creditsUsed: 1 });
  });

  it("pooled removal on the member's account, then the first-class retry", async () => {
    const plan = addPlan({ type: "GROUP", duration: "Monthly", period: "/month", classLimit: 5 });
    const { purchase, membership, others, confirmed } = await purchaseWithFailedFirstClass(plan, 5);

    // The customer activates: the record now belongs to their account.
    const url = new URL(confirmed.activation.activationUrl);
    const activated: any = await membershipActivationService.completeActivation({
      membershipNumber: url.searchParams.get("membership")!,
      activationToken: url.searchParams.get("token")!,
      password: "CorrectHorse1!",
    } as any);
    const userId = activated.user.id;
    expect(fake.get("memberMembership", membership.id).userId).toBe(userId);

    await adminCreditsService.removePoolCredits({
      memberId: userId,
      membershipType: "GROUP",
      credits: 3,
      expectedRemaining: 5,
    });

    freeSeats(others);
    const result = await retry(purchase.id);

    expect(result.firstClass.status).toBe("CONFIRMED");
    expect(fake.get("memberMembership", membership.id)).toMatchObject({ creditsTotal: 2, creditsUsed: 1 });
  });

  it("all credits removed: the first class is refused and nothing is restored", async () => {
    const plan = addPlan({ type: "GROUP", duration: "Monthly", period: "/month", classLimit: 5 });
    const { purchase, membership, others } = await purchaseWithFailedFirstClass(plan, 5);

    await adminCreditsService.removeCredits({
      memberId: membership.userId,
      memberMembershipId: membership.id,
      credits: 5,
      expectedRemaining: 5,
    });

    freeSeats(others);
    const result = await retry(purchase.id);

    expect(result.firstClass.status).toBe("NOT_CONFIRMED");
    expect(result.firstClass.reason).toMatch(/remaining class credits/i);
    expect(fake.get("memberMembership", membership.id)).toMatchObject({ creditsTotal: 0, creditsUsed: 0 });
  });

  it("with no removal, the first class still uses one of the full allowance (unchanged)", async () => {
    const plan = addPlan({ type: "GROUP", duration: "Monthly", period: "/month", classLimit: 5 });
    const { purchase, membership, others } = await purchaseWithFailedFirstClass(plan, 5);

    freeSeats(others);
    const result = await retry(purchase.id);

    expect(result.firstClass.status).toBe("CONFIRMED");
    expect(fake.get("memberMembership", membership.id)).toMatchObject({ creditsTotal: 5, creditsUsed: 1 });
  });
});

describe("a first-class retry never reactivates a membership that is no longer active", () => {
  async function activate(confirmed: any) {
    const url = new URL(confirmed.activation.activationUrl);
    const activated: any = await membershipActivationService.completeActivation({
      membershipNumber: url.searchParams.get("membership")!,
      activationToken: url.searchParams.get("token")!,
      password: "CorrectHorse1!",
    } as any);
    return activated.user.id as string;
  }

  it("after an upgrade replaced it: the old record stays EXPIRED and its carried credits are not duplicated", async () => {
    const plan = addPlan({ type: "GROUP", duration: "Monthly", period: "/month", classLimit: 5 });
    const bigPlan = addPlan({ type: "GROUP", duration: "2 Months", period: "/2 months", classLimit: 10, price: 90000 });
    const { purchase, membership, others, confirmed } = await purchaseWithFailedFirstClass(plan, 5);
    const userId = await activate(confirmed);

    // The member upgrades before the first class is booked: the old
    // record is replaced and its 5 unused credits move to the new one.
    const upgrade = await membershipService.initiateUpgrade(userId, bigPlan.id);
    await membershipService.completeMembershipPurchase(upgrade.reference);
    const old = fake.get("memberMembership", membership.id);
    expect(old.status).toBe("EXPIRED");
    const replacement = fake.tables.memberMembership.find((row) => row.userId === userId && row.status === "ACTIVE")!;
    expect(replacement.membershipId).toBe(bigPlan.id);
    const carried = { creditsTotal: replacement.creditsTotal, creditsUsed: replacement.creditsUsed };
    expect(carried).toEqual({ creditsTotal: 15, creditsUsed: 0 }); // 10 + 5 carried
    const oldBefore = { ...old };

    // The original first class's seat frees up; the admin retries it.
    freeSeats(others);
    const result = await retry(purchase.id);

    expect(result.firstClass).toMatchObject({ status: "NOT_CONFIRMED", retryAvailable: false });
    expect(result.firstClass.reason).toContain("no longer active");
    // The old record is untouched: still EXPIRED, no credit used.
    expect(fake.get("memberMembership", membership.id)).toEqual(oldBefore);
    // The member holds only the replacement's credits, once.
    const active = fake.tables.memberMembership.filter((row) => row.userId === userId && row.status === "ACTIVE");
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject(carried);
    // The first booking stays unconfirmed.
    const first = fake.tables.booking.find((row) => row.paymentReference === `${purchase.paymentReference}-FIRST-BOOKING`);
    expect(first?.bookingStatus).not.toBe("CONFIRMED");
  });

  it.each(["EXPIRED", "CANCELLED"])("a %s record is refused for GROUP and PRIVATE plans alike", async (status) => {
    for (const plan of [
      addPlan({ type: "GROUP", duration: "Monthly", period: "/month", classLimit: 5 }),
      addPlan({ type: "PRIVATE", duration: "Package", period: "package", classLimit: 5 }),
    ]) {
      const { purchase, membership, others } = await purchaseWithFailedFirstClass(plan, plan.type === "GROUP" ? 5 : 1);
      fake.get("memberMembership", membership.id).status = status;
      const before = { ...fake.get("memberMembership", membership.id) };

      freeSeats(others);
      const result = await retry(purchase.id);

      expect(result.firstClass).toMatchObject({ status: "NOT_CONFIRMED", retryAvailable: false });
      expect(fake.get("memberMembership", membership.id)).toEqual(before);
    }
  });

  it("an ACTIVE record still books its first class, GROUP and PRIVATE (unchanged)", async () => {
    for (const plan of [
      addPlan({ type: "GROUP", duration: "Monthly", period: "/month", classLimit: 5 }),
      addPlan({ type: "PRIVATE", duration: "Package", period: "package", classLimit: 5 }),
    ]) {
      const { purchase, membership, others } = await purchaseWithFailedFirstClass(plan, plan.type === "GROUP" ? 5 : 1);
      freeSeats(others);
      const result = await retry(purchase.id);

      expect(result.firstClass.status).toBe("CONFIRMED");
      expect(fake.get("memberMembership", membership.id)).toMatchObject({ status: "ACTIVE", creditsTotal: 5, creditsUsed: 1 });
      expect(fake.get("memberMembership", membership.id).startDate).not.toBeNull();
    }
  });

  it("a first class that was already confirmed is still returned unchanged after the membership ends", async () => {
    const plan = addPlan({ type: "GROUP", duration: "Monthly", period: "/month", classLimit: 5 });
    const { purchase, membership, others } = await purchaseWithFailedFirstClass(plan, 5);
    freeSeats(others);
    expect((await retry(purchase.id)).firstClass.status).toBe("CONFIRMED");

    fake.get("memberMembership", membership.id).status = "EXPIRED";
    const again = await retry(purchase.id);

    expect(again.firstClass.status).toBe("CONFIRMED");
    expect(fake.get("memberMembership", membership.id)).toMatchObject({ status: "EXPIRED", creditsUsed: 1 });
  });
});
