/* eslint-disable @typescript-eslint/no-explicit-any -- request/response stubs for the payment controller */
/**
 * In-memory tests (Prisma replaced by tests/helpers/fake-prisma):
 *
 * 1. Offline booking activation and admin-added memberships use the
 *    shared duration rules and start on the first booked session.
 * 2. A verified payment for a FAILED (cancelled or superseded)
 *    purchase is recorded for reconciliation, never silently dropped;
 *    webhook retries are acknowledged; admins can apply or refund it.
 * 3. The credit summary separates usable credits from queued ones.
 *
 * Only the payment provider (axios), email, Google Calendar and the
 * admin notification sender are stubbed. Real-database behaviour
 * (locks, unique notification keys) is in tests/postgres.
 */
import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePrisma, type Row } from "../helpers/fake-prisma";
import { SEEDED_PLANS, addMonths } from "../helpers/seeded-plans";

const fake = createFakePrisma();

vi.mock("../../src/config/prisma.js", () => ({ default: fake.prisma }));

// The Paymish provider: initialize returns a payment link, verify
// reports a completed transaction.
vi.mock("axios", () => {
  const post = vi.fn(async (_url: string, payload: { reference: string }) => ({
    data: {
      status: true,
      data: {
        authorization_url: `https://pay.test/${payload.reference}`,
        reference: payload.reference,
      },
    },
  }));
  const get = vi.fn(async (url: string) => {
    const reference = decodeURIComponent(url.split("/").pop() ?? "");
    return {
      data: { status: "success", data: { status: "completed", reference } },
    };
  });
  return { default: { post, get, isAxiosError: () => false } };
});

vi.mock("../../src/utils/mailer.js", () => ({
  sendPaymentConfirmationEmail: vi.fn(async () => undefined),
  sendAdminPaymentNotificationEmail: vi.fn(async () => undefined),
}));

vi.mock("../../src/google-calendar/google-calendar.service.js", () => ({
  googleCalendarService: {
    createBookingEvent: vi.fn(async () => ({ eventId: null, eventUrl: null })),
  },
}));

const createForAllAdmins = vi.fn(async () => ({ created: 1, pushSent: 0 }));

vi.mock("../../src/admin/admin-notification.service.js", () => ({
  adminNotificationService: { createForAllAdmins },
}));

const { default: membershipService, PURCHASE_RECONCILIATION } = await import(
  "../../src/membership/membership.service.js"
);
const { default: bookingService } = await import(
  "../../src/booking/booking.service.js"
);
const { membershipActivationService } = await import(
  "../../src/membership-activation/membership-activation.service.js"
);
const { default: paymentService } = await import(
  "../../src/payment/payment.service.js"
);
const { default: paymentController } = await import(
  "../../src/payment/payment.controller.js"
);

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------

const USER_ID = "user_1";
const EMAIL = "member@example.com";
const WEBHOOK_SECRET = "test-webhook-secret";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

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

  return fake.insert("classSession", {
    scheduleId: schedule.id,
    sessionDate,
    status: "OPEN",
  });
}

const row = (id: string) => fake.get("memberMembership", id);

const rowForBooking = (bookingId: string) =>
  row(fake.get("booking", bookingId).memberMembershipId);

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

const summary = () => bookingService.getMembershipCreditSummary(USER_ID);

/** A signed Paymish "transaction.successful" webhook. */
function webhook(reference: string) {
  const body = Buffer.from(
    JSON.stringify({ event: "transaction.successful", data: { reference } })
  );
  const signature = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(body)
    .digest("hex");
  return paymentService.handleWebhook(body, signature);
}

/** The Paymish redirect back to the site after payment. */
async function paymentCallback(reference: string) {
  const res = {
    redirect: vi.fn(),
    status: vi.fn(() => res),
    json: vi.fn(() => res),
  };
  await paymentController.callback(
    { query: { reference }, method: "GET", originalUrl: "/callback" } as any,
    res as any
  );
  return res.redirect.mock.calls[0]?.[0] as string;
}

beforeEach(() => {
  fake.reset();
  createForAllAdmins.mockClear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-24T09:00:00.000Z"));

  process.env.PAYMISH_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.PAYMISH_BASE_URL = "https://paymish.test";
  process.env.FRONTEND_URL = "https://site.test";
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
    role: "MEMBER",
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------
// 1. Offline booking activation and admin-added memberships
// ---------------------------------------------------------------------

/**
 * Offline booking activation sends the activation email as part of
 * the flow, and rolls back if it fails. Answer the email API locally
 * with success; nothing leaves the machine.
 */
function stubSuccessfulActivationEmail() {
  process.env.RESEND_API_KEY = "test-key";
  process.env.EMAIL_FROM = "noreply@sculpt.test";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({ id: "email_1" }),
    }))
  );
}

describe.each(SEEDED_PLANS)("offline and admin activation: $label", ({ plan: planData, expiryFrom }) => {
  const FIRST_SESSION = d("2026-11-03");

  beforeEach(stubSuccessfulActivationEmail);
  afterEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
  });

  it("offline booking with a session: starts on the session date, not the approval date", async () => {
    const plan = addPlan(planData);
    const session = addSession(FIRST_SESSION);
    const booking = fake.insert("booking", {
      userId: USER_ID,
      email: EMAIL,
      fullName: "Test Member",
      membershipId: plan.id,
      sessionId: session.id,
      bookingDate: FIRST_SESSION,
      preferredStartDate: FIRST_SESSION,
      amount: plan.price,
      paymentReference: "OFFLINE-1",
      paymentMethod: "OFFLINE",
      // What confirmOfflinePayment does before activating.
      paymentStatus: "PAID",
      bookingStatus: "CONFIRMED",
    });

    vi.setSystemTime(new Date("2026-10-26T12:00:00.000Z")); // approval
    await membershipActivationService.createActivationForBooking(booking.id);

    const membership = rowForBooking(booking.id);
    expect(membership.startDate).toEqual(FIRST_SESSION);
    expect(membership.expiryDate).toEqual(expiryFrom(FIRST_SESSION));
  });

  it("offline onboarding without a session: waits, then starts on the first booked session", async () => {
    const plan = addPlan(planData);
    // What onboarding an offline member creates: paid, confirmed,
    // no session.
    const booking = fake.insert("booking", {
      userId: USER_ID,
      email: EMAIL,
      fullName: "Test Member",
      membershipId: plan.id,
      amount: plan.price,
      paymentReference: "OFFLINE-2",
      paymentMethod: "OFFLINE",
      paymentStatus: "PAID",
      bookingStatus: "CONFIRMED",
    });

    await membershipActivationService.createActivationForBooking(booking.id);

    const membership = rowForBooking(booking.id);
    expect(membership.startDate).toBeNull();
    expect(membership.expiryDate).toBeNull();
    expect((await summary())?.requiresInitialBooking).toBe(true);

    const first = await bookSession(FIRST_SESSION, planData.type);

    expect(first.memberMembershipId).toBe(membership.id);
    expect(row(membership.id).startDate).toEqual(FIRST_SESSION);
    expect(row(membership.id).expiryDate).toEqual(expiryFrom(FIRST_SESSION));
    expect((await summary())?.requiresInitialBooking).toBe(false);
  });

  it("admin-added without a start date: waits, then starts on the first booked session", async () => {
    const plan = addPlan(planData);

    const membership = await membershipActivationService.createManualMembershipForRegisteredUser({
      userId: USER_ID,
      membershipId: plan.id,
    });

    expect(membership.startDate).toBeNull();
    expect(membership.expiryDate).toBeNull();

    await bookSession(FIRST_SESSION, planData.type);

    expect(row(membership.id).startDate).toEqual(FIRST_SESSION);
    expect(row(membership.id).expiryDate).toEqual(expiryFrom(FIRST_SESSION));
  });

  it("admin-added with a start date: keeps it and applies the plan's duration", async () => {
    const plan = addPlan(planData);

    const membership = await membershipActivationService.createManualMembershipForRegisteredUser({
      userId: USER_ID,
      membershipId: plan.id,
      startDate: "2026-10-01",
    });

    expect(membership.startDate).toEqual(d("2026-10-01"));
    expect(membership.expiryDate).toEqual(expiryFrom(d("2026-10-01")));
  });
});

describe("offline onboarding keeps the admin's remaining credits", () => {
  beforeEach(stubSuccessfulActivationEmail);
  afterEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
  });

  it("uses the onboarded credit balance at the first booking", async () => {
    const plan = addPlan({ type: "GROUP", duration: "Quarterly", period: "3 months", classLimit: 10 });
    const booking = fake.insert("booking", {
      userId: USER_ID,
      email: EMAIL,
      membershipId: plan.id,
      amount: plan.price,
      paymentReference: "OFFLINE-3",
      paymentMethod: "OFFLINE",
      paymentStatus: "PAID",
      bookingStatus: "CONFIRMED",
    });

    await membershipActivationService.createActivationForBooking(booking.id, 3);
    const membership = rowForBooking(booking.id);
    expect(membership.creditsUsed).toBe(7);

    await bookSession(d("2026-11-03"));

    expect(row(membership.id).creditsUsed).toBe(8);
    expect(row(membership.id).expiryDate).toEqual(addMonths(d("2026-11-03"), 3));
  });
});

// ---------------------------------------------------------------------
// 2. Paid FAILED purchases
// ---------------------------------------------------------------------

describe("verified payment for a cancelled or superseded purchase", () => {
  let current: Row;
  let older: { reference: string };
  let newer: { reference: string };

  beforeEach(async () => {
    vi.setSystemTime(d("2026-11-15"));
    const monthly = addPlan({ type: "GROUP", duration: "Monthly", period: "/month", classLimit: 8 });
    const twoMonth = addPlan({ type: "GROUP", duration: "2 Months", period: "/2 months", classLimit: 16 });
    const quarterly = addPlan({ type: "GROUP", duration: "Quarterly", period: "3 months", classLimit: 24 });

    current = fake.insert("memberMembership", {
      userId: USER_ID,
      membershipId: monthly.id,
      status: "ACTIVE",
      startDate: d("2026-11-01"),
      expiryDate: d("2026-12-01"),
      creditsTotal: 8,
      creditsUsed: 3,
    });

    // The customer starts an upgrade, then starts another one,
    // which supersedes the first. They then pay the first link.
    tick();
    older = await membershipService.initiateUpgrade(USER_ID, twoMonth.id);
    tick();
    newer = await membershipService.initiateUpgrade(USER_ID, quarterly.id);
    expect(purchaseByReference(older.reference).paymentStatus).toBe("FAILED");
    void quarterly;
  });

  it("the webhook records it, notifies admins and acknowledges without applying it", async () => {
    const result = await webhook(older.reference);

    expect(result).toMatchObject({
      received: true,
      processed: false,
      reconciliationRequired: true,
    });

    const purchase = purchaseByReference(older.reference);
    expect(purchase.paymentStatus).toBe("FAILED");
    expect(purchase.paymentRejectionReason).toMatch(
      new RegExp(`^${PURCHASE_RECONCILIATION.NEEDS_REVIEW} \\| .+ \\| webhook$`)
    );
    expect(activeRows().map((item) => item.id)).toEqual([current.id]);

    expect(createForAllAdmins).toHaveBeenCalledTimes(1);
    expect(createForAllAdmins).toHaveBeenCalledWith(
      expect.objectContaining({ eventKey: `paid-failed-purchase:${older.reference}` })
    );

    const list = await membershipService.getPurchasesNeedingReconciliation();
    expect(list.map((item: Row) => item.paymentReference)).toEqual([older.reference]);
  });

  it("webhook retries are acknowledged and do not change the record", async () => {
    await webhook(older.reference);
    const recorded = purchaseByReference(older.reference).paymentRejectionReason;

    tick();
    const retry = await webhook(older.reference);
    const callbackRedirect = await paymentCallback(older.reference);

    expect(retry).toMatchObject({ received: true, reconciliationRequired: true });
    expect(callbackRedirect).toContain("payment=review");
    expect(purchaseByReference(older.reference).paymentRejectionReason).toBe(recorded);

    // Same event key every time, so admins get one notification.
    const keys = new Set(
      createForAllAdmins.mock.calls.map((call: any[]) => call[0].eventKey)
    );
    expect([...keys]).toEqual([`paid-failed-purchase:${older.reference}`]);
  });

  it("the payment callback tells the customer it is under review, not that it succeeded", async () => {
    const redirect = await paymentCallback(older.reference);

    expect(redirect).toBe(
      `https://site.test/confirmation?payment=review&type=membership&reference=${encodeURIComponent(older.reference)}`
    );
    expect(redirect).not.toContain("status=success");
    expect(purchaseByReference(older.reference).paymentRejectionReason).toMatch(
      /\| payment-callback$/
    );
  });

  it("an admin can apply it: it completes once, with the normal upgrade rules", async () => {
    await webhook(older.reference);
    const purchase = purchaseByReference(older.reference);

    await membershipService.applyPaidFailedPurchase(purchase.id);

    expect(purchaseByReference(older.reference).paymentStatus).toBe("PAID");
    expect(purchaseByReference(older.reference).paymentRejectionReason).toMatch(
      new RegExp(`^${PURCHASE_RECONCILIATION.APPLIED} \\| `)
    );

    const upgraded = fake.tables.memberMembership.find(
      (item) => item.membershipPurchaseId === purchase.id
    )!;
    // 16 new + 5 unused carried + 3 used kept; Dec 1 + 2 months.
    expect(upgraded.creditsTotal).toBe(24);
    expect(upgraded.expiryDate).toEqual(addMonths(d("2026-12-01"), 2));
    expect(activeRows().map((item) => item.id)).toEqual([upgraded.id]);
    expect(await membershipService.getPurchasesNeedingReconciliation()).toHaveLength(0);

    // A late webhook retry is now a normal, idempotent completion.
    const retry = await webhook(older.reference);
    expect(retry).toMatchObject({ processed: true });
    expect(activeRows()).toHaveLength(1);
  });

  it("an admin can record a refund instead; it is never applied afterwards", async () => {
    await webhook(older.reference);
    const purchase = purchaseByReference(older.reference);

    await membershipService.markPaidFailedPurchaseRefunded(purchase.id, "Refunded via Paymish");

    const refunded = purchaseByReference(older.reference);
    expect(refunded.paymentStatus).toBe("FAILED");
    expect(refunded.paymentRejectionReason).toMatch(
      new RegExp(`^${PURCHASE_RECONCILIATION.REFUNDED} \\| .+ \\| Refunded via Paymish \\| `)
    );
    expect(await membershipService.getPurchasesNeedingReconciliation()).toHaveLength(0);

    await expect(membershipService.applyPaidFailedPurchase(purchase.id)).rejects.toThrow(
      "No verified payment is recorded"
    );

    // A late retry is acknowledged and leaves the refund record alone.
    const retry = await webhook(older.reference);
    expect(retry).toMatchObject({ reconciliationRequired: true });
    expect(purchaseByReference(older.reference).paymentRejectionReason).toBe(
      refunded.paymentRejectionReason
    );
    expect(activeRows().map((item) => item.id)).toEqual([current.id]);
  });

  it("a cancelled purchase with no recorded payment cannot be applied or refunded", async () => {
    const purchase = purchaseByReference(older.reference);

    await expect(membershipService.applyPaidFailedPurchase(purchase.id)).rejects.toThrow(
      "No verified payment is recorded"
    );
    await expect(
      membershipService.markPaidFailedPurchaseRefunded(purchase.id)
    ).rejects.toThrow("awaiting reconciliation");
  });

  it("the current purchase still completes normally", async () => {
    const result = await webhook(newer.reference);

    expect(result).toMatchObject({ processed: true });
    expect(purchaseByReference(newer.reference).paymentStatus).toBe("PAID");
    expect(createForAllAdmins).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------
// 3. Credit summary: usable vs queued
// ---------------------------------------------------------------------

describe("credit summary separates usable and queued credits", () => {
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
      creditsUsed: 7,
    });

    tick();
    const result = await membershipService.initiateRenewal(USER_ID);
    await membershipService.completeMembershipPurchase(result.reference);
    renewal = fake.tables.memberMembership.find(
      (item) =>
        item.membershipPurchaseId === purchaseByReference(result.reference).id
    )!;
  });

  it("counts only the current membership's credits as available", async () => {
    const result = await summary();
    const pool = result!.creditPools.GROUP!;

    expect(result!.remainingCredits).toBe(1);
    expect(result!.creditsTotal).toBe(8);
    expect(pool.remainingCredits).toBe(1);
    expect(pool.memberMembershipIds).toEqual([current.id]);
    expect(pool.expiryDate).toEqual(d("2026-12-01"));

    expect(result!.queuedCredits).toBe(8);
    expect(pool.queued).toMatchObject({
      memberMembershipIds: [renewal.id],
      remainingCredits: 8,
      startDate: d("2026-12-01"),
      expiryDate: addMonths(d("2026-12-01"), 1),
    });

    // Everything held, queued renewal included.
    expect(result!.validUntil).toEqual(addMonths(d("2026-12-01"), 1));
  });

  it("the renewal's credits become available once it starts", async () => {
    vi.setSystemTime(d("2026-12-02"));

    const result = await summary();

    expect(result!.remainingCredits).toBe(8);
    expect(result!.creditPools.GROUP!.memberMembershipIds).toEqual([renewal.id]);
    expect(result!.creditPools.GROUP!.queued).toBeNull();
    expect(result!.queuedCredits).toBe(0);
  });

  it("an unlimited queued renewal does not make current credits unlimited", async () => {
    const unlimited = addPlan({ type: "GROUP", duration: "Monthly", period: "/month", classLimit: null });
    tick();
    const result = await membershipService.initiateRenewal(USER_ID, unlimited.id);
    await membershipService.completeMembershipPurchase(result.reference);

    const credits = await summary();

    expect(credits!.unlimited).toBe(false);
    expect(credits!.remainingCredits).toBe(1);
    expect(credits!.queuedCredits).toBeNull();
    expect(credits!.creditPools.GROUP!.queued!.unlimited).toBe(true);
  });

  it("a membership awaiting its first booking counts as available, since it can book now", async () => {
    const privatePlan = addPlan({ type: "PRIVATE", duration: "Package", period: "package", classLimit: 5 });
    const awaiting = await membershipActivationService.createManualMembershipForRegisteredUser({
      userId: USER_ID,
      membershipId: privatePlan.id,
    });

    const result = await summary();
    const pool = result!.creditPools.PRIVATE!;

    expect(pool.memberMembershipIds).toEqual([awaiting.id]);
    expect(pool.remainingCredits).toBe(5);
    expect(pool.queued).toBeNull();
    expect(pool.requiresInitialBooking).toBe(true);
  });
});
