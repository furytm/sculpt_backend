/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed results and mock call arguments */
/**
 * Linking a legacy offline membership to its customer's account, in
 * memory (Prisma replaced by tests/helpers/fake-prisma).
 *
 * The records are what legacy offline onboarding left: a paid OFFLINE
 * booking and its membership with no userId, past class history, and
 * an unused activation. The customer gets the activation link through
 * the real admin resend (the email is answered locally and the link is
 * read from it), then completes it through the real completeActivation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePrisma, type Row } from "../helpers/fake-prisma";
import { addMonths } from "../helpers/seeded-plans";

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

vi.mock("../../src/utils/mailer.js", () => ({
  sendPasswordResetEmail: vi.fn(async () => undefined),
  sendVerificationEmail: vi.fn(async () => undefined),
  sendPaymentConfirmationEmail: vi.fn(async () => undefined),
  sendAdminPaymentNotificationEmail: vi.fn(async () => undefined),
}));

vi.mock("../../src/google-calendar/google-calendar.service.js", () => ({
  googleCalendarService: {
    createBookingEvent: vi.fn(async () => ({ eventId: null, eventUrl: null })),
    deleteBookingEvent: vi.fn(async () => undefined),
  },
}));

vi.mock("../../src/admin/admin-notification.service.js", () => ({
  adminNotificationService: {
    createForAllAdmins: vi.fn(async () => ({ created: 0, pushSent: 0 })),
  },
}));

const { adminService } = await import("../../src/admin/admin.service.js");
const { membershipActivationService } = await import(
  "../../src/membership-activation/membership-activation.service.js"
);
const { default: membershipService } = await import(
  "../../src/membership/membership.service.js"
);

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------

const EMAIL = "customer@example.com";
const NOW = new Date("2026-11-08T09:00:00.000Z");
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const emailFetch = vi.fn<(url: string, init?: any) => Promise<any>>(async () => ({
  ok: true,
  status: 200,
  text: async () => "",
  json: async () => ({ id: "email_1" }),
}));

/** The activation token from the most recent activation email. */
function tokenFromLastEmail() {
  const call = emailFetch.mock.calls.at(-1)!;
  const body = JSON.parse(call[1].body);
  const match = /token=([a-f0-9]{64})/.exec(body.html);
  if (!match) throw new Error("No activation link in the email.");
  return match[1];
}

let monthly: Row;
let twoMonth: Row;

function addPlans() {
  monthly = fake.insert("membership", {
    name: "10 Classes/Month",
    slug: "monthly-10",
    type: "GROUP",
    price: 50000,
    period: "/month",
    duration: "Monthly",
    classLimit: 10,
    isActive: true,
    features: [],
  });
  twoMonth = fake.insert("membership", {
    name: "2 Months",
    slug: "two-month",
    type: "GROUP",
    price: 90000,
    period: "/2 months",
    duration: "2 Months",
    classLimit: 16,
    isActive: true,
    features: [],
  });
}

/** A legacy offline member: booking, membership, history, activation. */
function addLegacyMember(overrides: { membership?: Row; booking?: Row } = {}) {
  const membership = fake.insert("memberMembership", {
    userId: null,
    membershipId: monthly.id,
    status: "ACTIVE",
    startDate: d("2026-10-01"),
    expiryDate: d("2026-11-30"),
    creditsTotal: 10,
    creditsUsed: 4,
    membershipNumber: "SL-LEGACY-0001",
    ...overrides.membership,
  });

  const booking = fake.insert("booking", {
    fullName: "Legacy Customer",
    email: EMAIL,
    phone: "08011112222",
    userId: null,
    membershipId: monthly.id,
    memberMembershipId: membership.id,
    amount: 50000,
    paymentReference: "OFFLINE-LEGACY-1",
    paymentMethod: "OFFLINE",
    paymentStatus: "PAID",
    bookingStatus: "CONFIRMED",
    ...overrides.booking,
  });

  // Past classes attended on this membership.
  const history = [d("2026-10-05"), d("2026-10-12")].map((date, index) =>
    fake.insert("booking", {
      fullName: "Legacy Customer",
      email: EMAIL,
      userId: null,
      membershipId: monthly.id,
      memberMembershipId: membership.id,
      bookingDate: date,
      amount: 0,
      paymentReference: `LEGACY-CLASS-${index}`,
      paymentMethod: "OFFLINE",
      paymentStatus: "PAID",
      bookingStatus: "CONFIRMED",
    })
  );

  const activation = fake.insert("membershipActivation", {
    bookingId: booking.id,
    memberMembershipId: membership.id,
    membershipNumber: "SL-LEGACY-0001",
    tokenHash: "unknown-old-token-hash",
    expiresAt: d("2026-10-08"), // the original link has long expired
    usedAt: null,
  });

  return { membership, booking, history, activation };
}

/** Admin resends the activation; returns the token from the email. */
async function adminResend(email = EMAIL) {
  const result = await adminService.resendRegistrationEmail(email);
  expect(result.message).toBe("Membership activation email resent successfully.");
  return tokenFromLastEmail();
}

const complete = (token: string, extra: Row = {}) =>
  membershipActivationService.completeActivation({
    membershipNumber: "SL-LEGACY-0001",
    activationToken: token,
    fullName: "Legacy Customer",
    password: "CorrectHorse1!",
    ...extra,
  } as any) as Promise<any>;

const counts = () => ({
  users: fake.tables.user.length,
  memberships: fake.tables.memberMembership.length,
  bookings: fake.tables.booking.length,
  activations: fake.tables.membershipActivation.length,
});

const snapshot = (row: Row) => structuredClone(row);

beforeEach(() => {
  fake.reset();
  emailFetch.mockClear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);

  process.env.RESEND_API_KEY = "test-key";
  process.env.EMAIL_FROM = "noreply@sculpt.test";
  process.env.JWT_ACCESS_SECRET = "test-access-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  vi.stubGlobal("fetch", emailFetch);

  addPlans();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
});

// ---------------------------------------------------------------------
// A. No account yet
// ---------------------------------------------------------------------

describe("customer with no account", () => {
  it("1, 5, 6, 8. completes activation: account created, original records linked, nothing else changed", async () => {
    const { membership, booking, history, activation } = addLegacyMember();
    const membershipBefore = snapshot(membership);
    const historyBefore = history.map(snapshot);
    const before = counts();

    const token = await adminResend();
    const result = await complete(token);

    expect(result.existingAccount).toBe(false);
    expect(result.accessToken).toBeTruthy();
    expect(counts()).toEqual({ ...before, users: before.users + 1 });

    const userId = result.user.id;
    expect(fake.get("booking", booking.id).userId).toBe(userId);

    // The membership only gains its owner.
    const after = fake.get("memberMembership", membership.id);
    expect(after.userId).toBe(userId);
    for (const field of ["status", "startDate", "expiryDate", "creditsTotal", "creditsUsed", "membershipNumber"]) {
      expect(after[field]).toEqual(membershipBefore[field]);
    }

    // Booking history unchanged.
    history.forEach((item, index) => {
      expect(fake.get("booking", item.id)).toEqual(historyBefore[index]);
    });

    expect(fake.get("membershipActivation", activation.id).usedAt).toEqual(NOW);
  });
});

// ---------------------------------------------------------------------
// B. Already registered with the same email
// ---------------------------------------------------------------------

describe("customer who already has an account with the same email", () => {
  it("2. links the original membership to the existing account, without a new user or a password change", async () => {
    const existing = fake.insert("user", {
      fullName: "Registered Online",
      email: "Customer@Example.com", // different case
      phone: "08099998888",
      password: "existing-password-hash",
      role: "MEMBER",
      isEmailVerified: true,
    });
    const { membership, booking } = addLegacyMember();
    const membershipBefore = snapshot(membership);
    const before = counts();

    const token = await adminResend();
    const result = await complete(token);

    expect(result.existingAccount).toBe(true);
    expect(result.user.id).toBe(existing.id);
    expect(counts()).toEqual(before);

    expect(fake.get("booking", booking.id).userId).toBe(existing.id);
    expect(fake.get("memberMembership", membership.id)).toMatchObject({
      ...membershipBefore,
      userId: existing.id,
      updatedAt: expect.anything(),
    });
    expect(fake.get("user", existing.id).password).toBe("existing-password-hash");
  });

  it("does not attach the membership to an account that only shares a name or phone", async () => {
    const lookalike = fake.insert("user", {
      fullName: "Legacy Customer",
      email: "someone.else@example.com",
      phone: "08011112222",
      password: "hash",
      role: "MEMBER",
    });
    const { membership } = addLegacyMember();

    const token = await adminResend();
    const result = await complete(token);

    expect(result.user.id).not.toBe(lookalike.id);
    expect(result.user.email).toBe(EMAIL);
    expect(fake.get("memberMembership", membership.id).userId).toBe(result.user.id);
  });

  it("9. renewal finds the linked legacy membership and adds to its remaining validity", async () => {
    const { membership } = addLegacyMember();
    const result = await complete(await adminResend());
    const userId = result.user.id;

    vi.setSystemTime(new Date(NOW.getTime() + 60_000));
    const renewal = await membershipService.initiateRenewal(userId);
    await membershipService.completeMembershipPurchase(renewal.reference);

    const renewed = fake.tables.memberMembership.find(
      (row) => row.id !== membership.id && row.userId === userId
    )!;
    expect(renewed.membershipId).toBe(monthly.id);
    expect(renewed.startDate).toEqual(d("2026-11-30"));
    expect(renewed.expiryDate).toEqual(addMonths(d("2026-11-30"), 1));
    expect(fake.get("memberMembership", membership.id).status).toBe("ACTIVE");
  });

  it("10. upgrade finds the linked legacy membership and carries its credits", async () => {
    const { membership } = addLegacyMember();
    const result = await complete(await adminResend());
    const userId = result.user.id;

    vi.setSystemTime(new Date(NOW.getTime() + 60_000));
    const upgrade = await membershipService.initiateUpgrade(userId, twoMonth.id);
    await membershipService.completeMembershipPurchase(upgrade.reference);

    const upgraded = fake.tables.memberMembership.find(
      (row) => row.id !== membership.id && row.userId === userId
    )!;
    // 16 new + 6 unused carried + 4 used kept.
    expect(upgraded.creditsTotal).toBe(26);
    expect(upgraded.creditsUsed).toBe(4);
    expect(upgraded.expiryDate).toEqual(addMonths(d("2026-11-30"), 2));
    expect(fake.get("memberMembership", membership.id).status).toBe("EXPIRED");
  });
});

// ---------------------------------------------------------------------
// C. Already linked
// ---------------------------------------------------------------------

describe("activation that has already been completed", () => {
  it("3. completing it again reports success and changes nothing", async () => {
    const { membership } = addLegacyMember();
    const token = await adminResend();
    const first = await complete(token);
    const before = counts();
    const membershipBefore = snapshot(fake.get("memberMembership", membership.id));
    const refreshTokens = fake.tables.refreshToken.length;

    const again = await complete(token);

    expect(again).toMatchObject({
      alreadyActivated: true,
      user: { id: first.user.id },
    });
    expect(again.accessToken).toBeUndefined(); // a used link doesn't sign in again
    expect(fake.tables.refreshToken).toHaveLength(refreshTokens);
    expect(counts()).toEqual(before);
    expect(fake.get("memberMembership", membership.id)).toEqual(membershipBefore);
  });

  it("a used activation with the wrong token is refused", async () => {
    addLegacyMember();
    await complete(await adminResend());

    await expect(complete("f".repeat(64))).rejects.toThrow("already been used");
  });

  it("is no longer found by resend", async () => {
    addLegacyMember();
    await complete(await adminResend());

    const result = await membershipActivationService.resendActivationForEmail(EMAIL);
    expect(result.found).toBe(false);
  });
});

// ---------------------------------------------------------------------
// D. Conflicts
// ---------------------------------------------------------------------

describe("records linked to a different account", () => {
  it("4. a membership linked to another user is not overwritten", async () => {
    const other = fake.insert("user", { fullName: "Other", email: "other@example.com", role: "MEMBER" });
    const { membership, activation } = addLegacyMember({ membership: { userId: other.id } });
    const before = counts();

    await expect(complete(await adminResend())).rejects.toThrow(
      "already linked to a different account"
    );

    expect(fake.get("memberMembership", membership.id).userId).toBe(other.id);
    expect(fake.get("membershipActivation", activation.id).usedAt).toBeNull();
    expect(counts()).toEqual(before);
  });

  it("4. a booking linked to another user is not overwritten", async () => {
    const other = fake.insert("user", { fullName: "Other", email: "other@example.com", role: "MEMBER" });
    const { booking, membership } = addLegacyMember({ booking: { userId: other.id } });

    await expect(complete(await adminResend())).rejects.toThrow(
      "already linked to a different account"
    );

    expect(fake.get("booking", booking.id).userId).toBe(other.id);
    expect(fake.get("memberMembership", membership.id).userId).toBeNull();
  });

  it("an activation whose membership doesn't belong to its booking is refused", async () => {
    const stray = fake.insert("memberMembership", {
      userId: null,
      membershipId: monthly.id,
      status: "ACTIVE",
      creditsTotal: 10,
      creditsUsed: 0,
    });
    const { membership } = addLegacyMember({ booking: { memberMembershipId: stray.id } });

    await expect(complete(await adminResend())).rejects.toThrow("does not match");
    expect(fake.get("memberMembership", membership.id).userId).toBeNull();
  });
});

// ---------------------------------------------------------------------
// Expired memberships and resends
// ---------------------------------------------------------------------

describe("validity and resends", () => {
  it("7. an expired membership stays expired after linking", async () => {
    const { membership } = addLegacyMember({
      membership: {
        status: "EXPIRED",
        startDate: d("2026-08-01"),
        expiryDate: d("2026-09-01"),
      },
    });

    const result = await complete(await adminResend());

    expect(fake.get("memberMembership", membership.id)).toMatchObject({
      userId: result.user.id,
      status: "EXPIRED",
      startDate: d("2026-08-01"),
      expiryDate: d("2026-09-01"),
      creditsUsed: 4,
    });
  });

  it("8. an active membership past its date keeps its status and dates (expiry is by date)", async () => {
    const { membership } = addLegacyMember({
      membership: { startDate: d("2026-09-01"), expiryDate: d("2026-10-01") },
    });

    await complete(await adminResend());

    expect(fake.get("memberMembership", membership.id)).toMatchObject({
      status: "ACTIVE",
      startDate: d("2026-09-01"),
      expiryDate: d("2026-10-01"),
    });
  });

  it("11. resending creates nothing new and only the latest link works", async () => {
    addLegacyMember();
    const before = counts();

    const firstToken = await adminResend();
    const secondToken = await adminResend("  CUSTOMER@example.com ");

    expect(counts()).toEqual(before);
    expect(secondToken).not.toBe(firstToken);

    await expect(complete(firstToken)).rejects.toThrow("Invalid activation token");
    const result = await complete(secondToken);
    expect(result.user.email).toBe(EMAIL);
    expect(counts()).toEqual({ ...before, users: before.users + 1 });
  });
});
