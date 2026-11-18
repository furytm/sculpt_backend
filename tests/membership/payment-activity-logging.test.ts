/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed fake rows and HTTP bodies */
/**
 * Membership purchase, upgrade and renewal, and the Paymish callback and
 * webhook, over HTTP against the real app, with the REAL payment
 * service. Only axios (Paymish), the mailer, calendar and admin
 * notifications are stubbed; Prisma is the in-memory fake.
 *
 * Two things are checked side by side:
 * 1. Behaviour is unchanged: responses, redirects, status codes, the
 *    Paymish request, and purchase/credit outcomes, including when
 *    the activity log cannot be written at all.
 * 2. The activity log records the expected events.
 */
import crypto from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createFakePrisma } from "../helpers/fake-prisma";

process.env.JWT_ACCESS_SECRET = "test-access-secret";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
process.env.RESEND_API_KEY = "re_test_dummy";
process.env.FRONTEND_URL = "https://site.test";
process.env.PAYMISH_BASE_URL = "https://paymish.test";
process.env.PAYMISH_SECRET_KEY = "sk_test_paymish_secret_key";
process.env.PAYMISH_CALLBACK_URL = "https://api.test/api/payments/callback";
process.env.PAYMISH_WEBHOOK_SECRET = "whsec_test_secret";

const fake = createFakePrisma();
vi.mock("../../src/config/prisma.js", () => ({ default: fake.prisma }));

const paymish = vi.hoisted(() => ({
  post: null as any,
  get: null as any,
}));

vi.mock("axios", () => {
  const isAxiosError = (error: any) => Boolean(error?.isAxiosError);
  return {
    default: {
      post: (...args: any[]) => paymish.post(...args),
      get: (...args: any[]) => paymish.get(...args),
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

vi.mock("../../src/google-calendar/google-calendar.service.js", () => ({
  googleCalendarService: {
    createBookingEvent: vi.fn(async () => ({ eventId: null, eventUrl: null })),
    deleteBookingEvent: vi.fn(async () => undefined),
  },
}));

const notifications = vi.hoisted(() => ({ fail: false }));
vi.mock("../../src/admin/admin-notification.service.js", () => ({
  AdminNotificationServiceError: class extends Error {},
  adminNotificationService: {
    createForAllAdmins: vi.fn(async () => {
      if (notifications.fail) throw new Error("push service down for admin@example.com");
    }),
  },
}));

let app: any;
let token: string;
let activityLog: any;

const USER_ID = "user_1";
const consoleOutput: string[] = [];

beforeAll(async () => {
  for (const method of ["log", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
    });
  }
  app = (await import("../../src/app.js")).default;
  activityLog = (await import("../../src/activity-log/activity-log.service.js")).activityLog;
  const { generateAccessToken } = await import("../../src/utils/jwt.js");
  token = generateAccessToken({ userId: USER_ID, email: "member@example.com", role: "MEMBER" } as any);
}, 60_000);

let plans: Record<string, any>;

const okInitialize = () =>
  vi.fn(async (_url: string, payload: any) => ({
    data: {
      status: "success",
      data: { authorization_url: `https://checkout.paymish.test/${payload.reference}`, reference: payload.reference },
    },
  }));

const completedVerify = () =>
  vi.fn(async (url: string) => {
    const reference = decodeURIComponent(url.split("/").pop() ?? "");
    return { data: { status: "success", data: { status: "completed", reference, customer: { email: "member@example.com" } } } };
  });

// A real axios failure: the request was sent; Paymish answered with an
// error, or (no status) never answered.
const providerRejection = (status: number | undefined, data?: unknown) =>
  Object.assign(new Error("Request failed"), {
    isAxiosError: true,
    code: status ? "ERR_BAD_RESPONSE" : "ECONNREFUSED",
    request: {},
    response: status ? { status, data } : undefined,
  });

// An axios error where no request was ever sent (e.g. no base URL).
const configRejection = () =>
  Object.assign(new Error("Invalid URL"), { isAxiosError: true, code: "ERR_INVALID_URL" });

beforeEach(() => {
  fake.reset();
  consoleOutput.length = 0;
  notifications.fail = false;
  paymish.post = okInitialize();
  paymish.get = completedVerify();
  fake.prisma.memberActivityLog.create.mockClear();

  plans = {
    monthly: fake.insert("membership", {
      name: "Monthly", slug: "monthly", type: "GROUP", duration: "Monthly", period: "/month",
      classLimit: 8, price: 50000, isActive: true, features: [],
    }),
    twoMonth: fake.insert("membership", {
      name: "Two Months", slug: "two-months", type: "GROUP", duration: "2 Months", period: "/2 months",
      classLimit: 16, price: 90000, isActive: true, features: [],
    }),
  };

  fake.insert("user", { id: USER_ID, fullName: "Test Member", email: "member@example.com", phone: "08000000000", role: "MEMBER" });

  fake.insert("memberMembership", {
    userId: USER_ID,
    membershipId: plans.monthly.id,
    status: "ACTIVE",
    startDate: new Date(Date.now() - 5 * 86_400_000),
    expiryDate: new Date(Date.now() + 25 * 86_400_000),
    creditsTotal: 8,
    creditsUsed: 3,
  });
});

const signedIn = () => ({ Authorization: `Bearer ${token}` });

// In the order the events happened (as an admin timeline would sort them).
const logs = () =>
  [...fake.tables.memberActivityLog].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
const events = () => logs().map((row) => `${row.action} ${row.stage}`);
const purchaseFor = (reference: string) =>
  fake.tables.membershipPurchase.find((row) => row.paymentReference === reference)!;

const upgrade = (membershipId: string | undefined = plans.twoMonth.id) =>
  request(app).post("/api/memberships/upgrade").set(signedIn()).send({ membershipId });

const callback = (reference?: string) =>
  request(app).get(`/api/payments/callback${reference ? `?reference=${encodeURIComponent(reference)}` : ""}`);

async function settle() {
  await activityLog.flush();
}

// ---------------------------------------------------------------------

describe("membership upgrade", () => {
  it("success: unchanged response and Paymish request; INITIATED then PAYMENT_INITIALIZED, one operation", async () => {
    const response = await upgrade();
    await settle();

    // Unchanged contract.
    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual(
      ["amount", "authorizationUrl", "carriedCredits", "membership", "message", "newCreditsTotal", "purchaseId", "reference", "reusedPendingPurchase"].sort()
    );
    expect(response.body.message).toBe("Membership upgrade payment initialized.");
    const { reference, purchaseId } = response.body;
    expect(response.body.authorizationUrl).toBe(`https://checkout.paymish.test/${reference}`);

    // Unchanged Paymish request: URL, payload and headers.
    expect(paymish.post).toHaveBeenCalledTimes(1);
    expect(paymish.post).toHaveBeenCalledWith(
      "https://paymish.test/api/transaction-service/external/v1/transaction-initialize",
      {
        email: "member@example.com",
        amount: 90000,
        currency: "NGN",
        channels: ["card", "ussd", "nqr", "transfer"],
        callback_url: "https://api.test/api/payments/callback",
        reference,
      },
      { headers: { Authorization: "Bearer sk_test_paymish_secret_key", "Content-Type": "application/json" } }
    );

    // Not complete yet: only a payment link exists.
    expect(purchaseFor(reference)).toMatchObject({ id: purchaseId, paymentStatus: "PENDING", type: "UPGRADE" });

    expect(events()).toEqual(["membership.upgrade INITIATED", "membership.upgrade PAYMENT_INITIALIZED"]);
    const [initiated, initialized] = logs();
    expect(initiated).toMatchObject({ userId: USER_ID, actorType: "MEMBER", status: "INFO", metadata: { targetMembershipId: plans.twoMonth.id } });
    expect(initialized).toMatchObject({
      userId: USER_ID,
      status: "INFO",
      entityType: "MEMBERSHIP_PURCHASE",
      entityId: purchaseId,
      paymentReference: reference,
      // The service's own (unchanged) credit figures.
      metadata: expect.objectContaining({
        purchaseId,
        amount: 90000,
        carriedCredits: response.body.carriedCredits,
        newCreditsTotal: response.body.newCreditsTotal,
      }),
    });
    // One operation: same request, correlated by the payment reference.
    expect(initiated.requestId).toBe(response.headers["x-request-id"]);
    expect(initialized.requestId).toBe(initiated.requestId);
    expect(initiated.correlationId).toBe(reference);
    expect(initialized.correlationId).toBe(reference);
  });

  it("Paymish failure: 502 with a safe message; the purchase is left as before (PENDING); failure recorded against it", async () => {
    paymish.post = vi.fn(async () => {
      throw providerRejection(422, {
        status: "error",
        message: "Invalid customer email ada@example.com",
        customer: { email: "ada@example.com", phone: "08011112222" },
      });
    });

    const response = await upgrade();
    await settle();

    expect(response.status).toBe(502);
    expect(response.body).toEqual({
      message: "We couldn't reach our payment provider. Please try again in a moment.",
      code: "PAYMENT_PROVIDER_ERROR",
      requestId: response.headers["x-request-id"],
    });
    expect(JSON.stringify(response.body)).not.toMatch(/ada@example|08011112222|Invalid customer/);

    // Business behaviour unchanged: the purchase row stays PENDING (not marked FAILED).
    const [purchase] = fake.tables.membershipPurchase;
    expect(purchase).toMatchObject({ type: "UPGRADE", paymentStatus: "PENDING" });

    expect(events()).toEqual([
      "membership.upgrade INITIATED",
      "payment.initialize PROVIDER_FAILED",
      "membership.upgrade PROVIDER_FAILED",
    ]);
    const providerEvent = logs()[1];
    expect(providerEvent).toMatchObject({
      status: "FAILURE",
      paymentReference: purchase.paymentReference,
      entityType: "MEMBERSHIP_PURCHASE",
      entityId: purchase.id,
      userId: USER_ID,
      errorCode: "PAYMENT_PROVIDER_ERROR",
      errorMessage: "Paymish initialize failed (HTTP 422): Invalid customer email [email]",
      metadata: { operation: "initialize", providerHttpStatus: 422, providerCode: "error", providerMessage: "Invalid customer email [email]" },
    });
    expect(logs()[2]).toMatchObject({ userId: USER_ID, httpStatus: 502, errorCode: "PAYMENT_PROVIDER_ERROR" });
    for (const row of logs()) expect(row.correlationId).toBe(purchase.paymentReference);
  });

  it("Paymish unreachable: 502, recorded as PAYMENT_PROVIDER_UNAVAILABLE", async () => {
    paymish.post = vi.fn(async () => {
      throw providerRejection(undefined);
    });
    const response = await upgrade();
    await settle();
    expect(response.status).toBe(502);
    expect(response.body.code).toBe("PAYMENT_PROVIDER_UNAVAILABLE");
    expect(logs()[1]).toMatchObject({ action: "payment.initialize", errorCode: "PAYMENT_PROVIDER_UNAVAILABLE" });
  });

  it("business rule: unchanged 400 and message (plus requestId); recorded as FAILED", async () => {
    const response = await upgrade(plans.monthly.id);
    await settle();

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: "You are already on this membership.", requestId: response.headers["x-request-id"] });
    expect(events()).toEqual(["membership.upgrade INITIATED", "membership.upgrade FAILED"]);
    expect(logs()[1]).toMatchObject({ errorCode: "REQUEST_REJECTED", errorMessage: "You are already on this membership.", httpStatus: 400 });
    expect(paymish.post).not.toHaveBeenCalled();
  });

  it("validation: unchanged 400 response; recorded as VALIDATION_FAILED", async () => {
    const response = await upgrade("");
    await settle();

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: "Target membership ID is required." });
    expect(logs()).toEqual([
      expect.objectContaining({ action: "membership.upgrade", stage: "VALIDATION_FAILED", metadata: { missingFields: "membershipId" } }),
    ]);
  });

  it("unauthenticated: unchanged 401, nothing recorded", async () => {
    const response = await request(app).post("/api/memberships/upgrade").send({ membershipId: plans.twoMonth.id });
    await settle();
    expect(response.status).toBe(401);
    expect(logs()).toHaveLength(0);
  });
});

describe("membership renewal and new purchase", () => {
  it("renewal: unchanged response; events recorded", async () => {
    const response = await request(app).post("/api/memberships/renew").set(signedIn()).send({ membershipId: plans.monthly.id });
    await settle();

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Membership renewal payment initialized.");
    expect(response.body.authorizationUrl).toBe(`https://checkout.paymish.test/${response.body.reference}`);
    expect(purchaseFor(response.body.reference)).toMatchObject({ type: "RENEWAL", paymentStatus: "PENDING" });
    expect(events()).toEqual(["membership.renewal INITIATED", "membership.renewal PAYMENT_INITIALIZED"]);
    expect(logs()[1]).toMatchObject({ entityId: response.body.purchaseId, paymentReference: response.body.reference });
  });

  it("guest purchase: unchanged 201 response; the guest is identified by email only", async () => {
    const response = await request(app).post("/api/memberships/purchase").send({
      membershipId: plans.monthly.id,
      fullName: "Gail Guest",
      email: "Gail@Example.com",
      phone: "08033334444",
    });
    await settle();

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      success: true,
      message: "Membership payment initialized.",
      data: { success: true, purchaseId: expect.any(String), reference: expect.any(String), authorizationUrl: expect.any(String) },
    });
    expect(events()).toEqual(["membership.purchase INITIATED", "membership.purchase PAYMENT_INITIALIZED"]);
    for (const row of logs()) {
      expect(row).toMatchObject({ userId: null, actorType: "GUEST", subjectEmail: "gail@example.com" });
      expect(JSON.stringify(row)).not.toMatch(/08033334444|Gail Guest/);
    }
  });

  it("guest purchase validation: unchanged 400 response; field names recorded, never values", async () => {
    const response = await request(app).post("/api/memberships/purchase").send({ membershipId: plans.monthly.id, fullName: "Gail" });
    await settle();

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ success: false, message: "Membership, name, email, and phone are required." });
    expect(logs()[0]).toMatchObject({ stage: "VALIDATION_FAILED", metadata: { missingFields: "email,phone" } });
  });

  it("guest purchase Paymish failure: 502 { success:false } with a safe message", async () => {
    paymish.post = vi.fn(async () => {
      throw providerRejection(500, { message: "boom" });
    });
    const response = await request(app).post("/api/memberships/purchase").send({
      membershipId: plans.monthly.id, fullName: "Gail Guest", email: "gail@example.com", phone: "08033334444",
    });
    await settle();

    expect(response.status).toBe(502);
    expect(response.body).toEqual({
      success: false,
      message: "We couldn't reach our payment provider. Please try again in a moment.",
      code: "PAYMENT_PROVIDER_ERROR",
      requestId: response.headers["x-request-id"],
    });
    expect(fake.tables.membershipPurchase[0].paymentStatus).toBe("PENDING");
  });
});

describe("payment callback", () => {
  it("verified upgrade: unchanged redirect and completion; verified + completed recorded once, even on a repeat", async () => {
    const { body } = await upgrade();
    const reference = body.reference;
    await settle();

    const first = await callback(reference);
    const second = await callback(reference); // e.g. the customer reloads
    await settle();

    const expected = `https://site.test/confirmation?status=success&mode=upgrade&reference=${encodeURIComponent(reference)}`;
    expect(first.status).toBe(302);
    expect(first.headers.location).toBe(expected);
    expect(second.headers.location).toBe(expected);

    // Unchanged business outcome: purchase PAID, credits carried, old row replaced.
    expect(purchaseFor(reference).paymentStatus).toBe("PAID");
    const upgraded = fake.tables.memberMembership.find((row) => row.membershipPurchaseId === body.purchaseId);
    expect(upgraded).toMatchObject({ status: "ACTIVE", creditsTotal: body.newCreditsTotal });

    const afterUpgrade = events().slice(2);
    expect(afterUpgrade).toEqual(["payment.callback VERIFIED", "membership.purchase_completion SUCCEEDED"]);
    const completion = logs().find((row) => row.action === "membership.purchase_completion")!;
    expect(completion).toMatchObject({
      status: "SUCCESS",
      userId: USER_ID,
      entityId: body.purchaseId,
      paymentReference: reference,
      correlationId: reference,
      metadata: { source: "/api/payments/callback" },
    });
    // The whole operation shares one correlation ID.
    expect(new Set(logs().map((row) => row.correlationId))).toEqual(new Set([reference]));
  });

  it("not verified: unchanged redirect; VERIFICATION_FAILED recorded; purchase stays PENDING", async () => {
    const { body } = await upgrade();
    paymish.get = vi.fn(async () => ({ data: { status: "success", data: { status: "pending", reference: body.reference } } }));

    const response = await callback(body.reference);
    await settle();

    expect(response.headers.location).toBe(`https://site.test/confirmation?payment=failed&reference=${encodeURIComponent(body.reference)}`);
    expect(purchaseFor(body.reference).paymentStatus).toBe("PENDING");
    expect(logs().at(-1)).toMatchObject({
      action: "payment.callback",
      stage: "VERIFICATION_FAILED",
      errorCode: "PAYMENT_NOT_VERIFIED",
      metadata: { verificationStatus: "success", transactionStatus: "pending", outcome: "payment=failed" },
    });
  });

  it("Paymish verify unreachable: unchanged redirect; provider failure recorded", async () => {
    const { body } = await upgrade();
    paymish.get = vi.fn(async () => {
      throw providerRejection(undefined);
    });

    const response = await callback(body.reference);
    await settle();

    expect(response.headers.location).toBe(`https://site.test/confirmation?payment=failed&reference=${encodeURIComponent(body.reference)}`);
    expect(events().slice(2)).toEqual(["payment.verify PROVIDER_FAILED", "payment.callback PROVIDER_FAILED"]);
  });

  it("no reference: unchanged redirect; recorded (capped)", async () => {
    const response = await callback();
    await callback();
    await settle();
    expect(response.headers.location).toBe("https://site.test/confirmation?payment=failed");
    expect(events()).toEqual(["payment.callback VALIDATION_FAILED"]);
  });

  it("a failed admin notification is a WARNING; the payment still succeeds", async () => {
    const { body } = await upgrade();
    notifications.fail = true;

    const response = await callback(body.reference);
    await settle();

    expect(response.headers.location).toContain("status=success");
    expect(purchaseFor(body.reference).paymentStatus).toBe("PAID");
    expect(logs().find((row) => row.stage === "WARNING")).toMatchObject({
      action: "payment.callback",
      errorCode: "NOTIFICATION_FAILED",
      errorMessage: "push service down for [email]",
      metadata: { notification: "admin_database" },
    });
  });
});

describe("payment webhook", () => {
  const sign = (body: string) => crypto.createHmac("sha256", "whsec_test_secret").update(body).digest("hex");
  const post = (body: string, signature: string) =>
    request(app).post("/api/payments/webhook").set("Content-Type", "application/json").set("x-paymish-signature", signature).send(body);

  it("bad signature: unchanged 400 and message; recorded", async () => {
    const response = await post(JSON.stringify({ event: "transaction.successful" }), "0".repeat(64));
    await settle();

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ success: false, message: "Invalid Paymish webhook signature.", requestId: response.headers["x-request-id"] });
    expect(logs()).toEqual([expect.objectContaining({ action: "payment.webhook", stage: "FAILED", errorCode: "WEBHOOK_SIGNATURE_INVALID" })]);
  });

  it("successful payment: unchanged 200 body and completion; recorded once across retries", async () => {
    const { body } = await upgrade();
    const payload = JSON.stringify({
      event: "transaction.successful",
      data: { reference: body.reference, status: "completed", customer: { email: "member@example.com", phone: "08000000000" } },
    });

    const first = await post(payload, sign(payload));
    const retry = await post(payload, sign(payload));
    await settle();

    expect(first.status).toBe(200);
    expect(first.body).toEqual({ received: true, processed: true, type: "membership", reference: body.reference });
    expect(retry.body).toEqual(first.body);
    expect(purchaseFor(body.reference).paymentStatus).toBe("PAID");

    expect(events().slice(2)).toEqual(["membership.purchase_completion SUCCEEDED", "payment.webhook SUCCEEDED"]);
    expect(logs().at(-1)).toMatchObject({ actorType: "WEBHOOK", correlationId: body.reference });
    // The webhook payload (customer details) was never printed.
    expect(consoleOutput.join("\n")).not.toMatch(/08000000000/);
  });
});

describe("logging can fail without changing anything", () => {
  it("with every activity-log write failing, upgrade + callback + webhook behave exactly the same", async () => {
    const realCreate = fake.prisma.memberActivityLog.create.getMockImplementation();
    fake.prisma.memberActivityLog.create.mockImplementation(async () => {
      throw new Error("relation \"MemberActivityLog\" does not exist");
    });

    // A Paymish failure first (the purchase stays PENDING, as before)...
    paymish.post = vi.fn(async () => {
      throw providerRejection(503, { message: "down" });
    });
    const failed = await upgrade();
    expect(failed.status).toBe(502);

    // ...then a successful upgrade and payment.
    paymish.post = okInitialize();
    const response = await upgrade();
    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Membership upgrade payment initialized.");

    const redirect = await callback(response.body.reference);
    expect(redirect.headers.location).toBe(
      `https://site.test/confirmation?status=success&mode=upgrade&reference=${encodeURIComponent(response.body.reference)}`
    );
    expect(purchaseFor(response.body.reference).paymentStatus).toBe("PAID");

    await settle();
    expect(logs()).toHaveLength(0);
    // Restore the fake's real implementation (mockReset would remove it).
    fake.prisma.memberActivityLog.create.mockImplementation(realCreate!);
  });
});

describe("no sensitive data reaches the console", () => {
  it("Paymish responses, secrets and customer details are not printed", async () => {
    await upgrade();
    paymish.post = vi.fn(async () => {
      throw providerRejection(422, { message: "bad email ada@example.com", customer: { phone: "08011112222" } });
    });
    await upgrade();
    await settle();

    const output = consoleOutput.join("\n");
    expect(output).not.toMatch(/checkout\.paymish\.test|sk_test_paymish|ada@example|08011112222|member@example\.com/);
    expect(output).toContain("paymish.initialize.ok");
    expect(output).toContain("paymish.initialize.failed");
  });

  it("the public initialize endpoint no longer returns the raw provider error", async () => {
    paymish.post = vi.fn(async () => {
      throw providerRejection(401, { message: "Invalid secret key sk_live_x" });
    });
    const response = await request(app).post("/api/payments/initialize").send({ email: "x@y.z", amount: 1, reference: "SL-PUB-1" });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      message: "Unable to initialize payment.",
      code: "PAYMENT_PROVIDER_ERROR",
      requestId: response.headers["x-request-id"],
    });
  });
});

describe("internal errors stay distinguishable from Paymish failures", () => {
  it("a programming error around the Paymish call: 500 INTERNAL_ERROR, recorded FAILED (not PROVIDER_FAILED), rethrown unchanged", async () => {
    paymish.post = vi.fn(async () => {
      throw new TypeError("Cannot read properties of undefined (reading 'data')");
    });

    const response = await upgrade();
    await settle();

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      message: "Something went wrong. Please try again.",
      code: "INTERNAL_ERROR",
      requestId: response.headers["x-request-id"],
    });
    expect(events()).toEqual([
      "membership.upgrade INITIATED",
      "payment.initialize FAILED",
      "membership.upgrade FAILED",
    ]);
    expect(logs()[1]).toMatchObject({ errorCode: "INTERNAL_ERROR", metadata: { operation: "initialize", errorKind: "internal" } });
    // Unchanged business behaviour: the purchase stays PENDING.
    expect(fake.tables.membershipPurchase[0].paymentStatus).toBe("PENDING");

    // Stack: in the server log, never in the response or the activity log.
    const consoleLine = consoleOutput.find((line) => line.includes("paymish.initialize.internal_error"))!;
    expect(JSON.parse(consoleLine).stack[0]).toContain("TypeError");
    for (const row of logs()) expect(JSON.stringify(row)).not.toMatch(/\bat \S+ \(|stack/);
  });

  it("an axios configuration error (request never sent) is internal, not a provider failure", async () => {
    paymish.post = vi.fn(async () => {
      throw configRejection();
    });
    const response = await upgrade();
    await settle();

    expect(response.status).toBe(500);
    expect(response.body.code).toBe("INTERNAL_ERROR");
    expect(logs().some((row) => row.stage === "PROVIDER_FAILED")).toBe(false);
  });

  it("an internal error while verifying: the callback redirect is unchanged", async () => {
    const { body } = await upgrade();
    paymish.get = vi.fn(async () => {
      throw new TypeError("bug");
    });

    const response = await callback(body.reference);
    await settle();

    expect(response.headers.location).toBe(`https://site.test/confirmation?payment=failed&reference=${encodeURIComponent(body.reference)}`);
    expect(events().slice(2)).toEqual(["payment.verify FAILED", "payment.callback FAILED"]);
    expect(purchaseFor(body.reference).paymentStatus).toBe("PENDING");
  });
});

describe("logging helper failures never change the business outcome", () => {
  it("activityLog.record throwing: upgrade still succeeds with the same response", async () => {
    const spy = vi.spyOn(activityLog, "record").mockImplementation(() => {
      throw new Error("logger exploded");
    });

    const response = await upgrade();
    spy.mockRestore();

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Membership upgrade payment initialized.");
    expect(purchaseFor(response.body.reference)).toMatchObject({ paymentStatus: "PENDING", type: "UPGRADE" });
  });

  it("a result field that throws when read for logging: the upgrade response is unaffected", async () => {
    const { default: membershipService } = await import("../../src/membership/membership.service.js");
    const original = membershipService.initiateUpgrade.bind(membershipService);
    const spy = vi.spyOn(membershipService, "initiateUpgrade").mockImplementation(async (...args: any[]) => {
      const result: any = await original(...(args as [string, string]));
      // Read only by the logging metadata (not part of the response).
      Object.defineProperty(result, "carriedCredits", {
        enumerable: false,
        get() {
          throw new Error("unreadable");
        },
      });
      return result;
    });

    const response = await upgrade();
    await settle();
    spy.mockRestore();

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Membership upgrade payment initialized.");
    expect(response.body.reference).toEqual(expect.any(String));
    // The event that needed the bad field was skipped; the operation was not.
    expect(events()).toEqual(["membership.upgrade INITIATED"]);
  });

  it("activityLog.record throwing on a failure path: the error response is unchanged", async () => {
    const spy = vi.spyOn(activityLog, "record").mockImplementation(() => {
      throw new Error("logger exploded");
    });
    const response = await upgrade(plans.monthly.id);
    spy.mockRestore();

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("You are already on this membership.");
  });
});

describe("purchase completion carries the payment reference as its correlation ID", () => {
  const paidGuestPurchase = (reference: string, email: string, extra: Record<string, unknown> = {}) =>
    fake.insert("membershipPurchase", {
      userId: null,
      email,
      fullName: "Paid Guest",
      phone: "08099990000",
      membershipId: plans.monthly.id,
      type: "NEW",
      paymentMethod: "PAYMISH",
      paymentStatus: "PAID",
      paymentReference: reference,
      amount: 50000,
      ...extra,
    });

  const completion = () => logs().find((row) => row.action === "membership.purchase_completion")!;

  it("registration", async () => {
    paidGuestPurchase("SL-REG-1", "reg@example.com");

    const response = await request(app).post("/api/auth/register").send({
      fullName: "Reg Member",
      email: "reg@example.com",
      password: "Password123",
      confirmPassword: "Password123",
      bookingReference: "SL-REG-1",
    });
    await settle();

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(completion()).toMatchObject({
      status: "SUCCESS",
      paymentReference: "SL-REG-1",
      correlationId: "SL-REG-1",
      requestId: response.headers["x-request-id"],
      metadata: { source: "/api/auth/register" },
    });
  });

  it("login", async () => {
    const { hashPassword } = await import("../../src/utils/bcrypt.js");
    fake.insert("user", {
      id: "user_login",
      fullName: "Login Member",
      email: "login@example.com",
      password: await hashPassword("Password123"),
      role: "MEMBER",
      provider: "LOCAL",
    });
    paidGuestPurchase("SL-LOGIN-1", "login@example.com");

    const response = await request(app)
      .post("/api/auth/login")
      .send({ email: "login@example.com", password: "Password123", bookingReference: "SL-LOGIN-1" });
    await settle();

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(completion()).toMatchObject({
      paymentReference: "SL-LOGIN-1",
      correlationId: "SL-LOGIN-1",
      requestId: response.headers["x-request-id"],
      metadata: { source: "/api/auth/login" },
    });
  });

  it("admin reconciliation", async () => {
    const { generateAccessToken } = await import("../../src/utils/jwt.js");
    fake.insert("user", { id: "admin_1", fullName: "Admin", email: "admin@example.com", role: "ADMIN" });
    const adminToken = generateAccessToken({ userId: "admin_1", email: "admin@example.com", role: "ADMIN" } as any);
    const purchase = paidGuestPurchase("SL-RECON-1", "member@example.com", {
      userId: USER_ID,
      type: "RENEWAL",
      paymentStatus: "FAILED",
      paymentRejectionReason: "PAID_NEEDS_RECONCILIATION | 2026-11-17T00:00:00.000Z | callback",
    });

    const response = await request(app)
      .post(`/api/admin/membership-purchases/${purchase.id}/reconciliation/apply`)
      .set({ Authorization: `Bearer ${adminToken}` });
    await settle();

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(completion()).toMatchObject({
      status: "SUCCESS",
      paymentReference: "SL-RECON-1",
      correlationId: "SL-RECON-1",
      requestId: response.headers["x-request-id"],
      metadata: { source: `/api/admin/membership-purchases/${purchase.id}/reconciliation/apply` },
    });
  });

  it("never overwrites a correlation ID another payment already set", async () => {
    const { default: membershipService } = await import("../../src/membership/membership.service.js");
    const { runWithRequestContext, setCorrelationId, getRequestContext } = await import(
      "../../src/observability/request-context.js"
    );
    paidGuestPurchase("SL-SECOND-1", "member@example.com", { userId: USER_ID, type: "RENEWAL", paymentStatus: "PENDING" });

    const contextCorrelation = await runWithRequestContext(async () => {
      setCorrelationId("SL-FIRST-PAYMENT");
      await membershipService.completeMembershipPurchase("SL-SECOND-1");
      return getRequestContext()?.correlationId;
    });
    await settle();

    expect(contextCorrelation).toBe("SL-FIRST-PAYMENT");
    expect(completion()).toMatchObject({ paymentReference: "SL-SECOND-1", correlationId: "SL-SECOND-1" });
  });
});
