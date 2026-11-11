/* eslint-disable @typescript-eslint/no-explicit-any -- services are imported dynamically after DATABASE_URL is set */
/**
 * Paid FAILED (cancelled or superseded) purchases against a REAL
 * PostgreSQL database: concurrent webhook retries and callbacks, and
 * admin reconciliation racing them. Real Prisma client, real row
 * locks, real unique constraints. Only the Paymish HTTP calls and
 * email are stubbed.
 *
 * Skipped unless TEST_DATABASE_URL is set; see
 * tests/postgres/membership-concurrency.pg.test.ts for setup. The
 * database must be local and its name must contain "test", because
 * every table is truncated. Run the postgres files with
 * --no-file-parallelism, since they share that database.
 */
import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const WEBHOOK_SECRET = "pg-test-webhook-secret";

if (TEST_DATABASE_URL) {
  const parsed = new URL(TEST_DATABASE_URL);
  const local = ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
  if (!local || !parsed.pathname.includes("test")) {
    throw new Error(
      "Refusing to run: TEST_DATABASE_URL must be a local database whose name contains \"test\"."
    );
  }
  parsed.searchParams.set("connection_limit", "10");
  process.env.DATABASE_URL = parsed.toString();
  process.env.PAYMISH_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.PAYMISH_BASE_URL = "https://paymish.test";
  process.env.FRONTEND_URL = "https://site.test";
}

// Paymish verify: a completed transaction for whatever is asked.
vi.mock("axios", () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(async (url: string) => {
      const reference = decodeURIComponent(url.split("/").pop() ?? "");
      return {
        data: { status: "success", data: { status: "completed", reference } },
      };
    }),
    isAxiosError: () => false,
  },
}));

vi.mock("../../src/utils/mailer.js", () => ({
  sendPaymentConfirmationEmail: vi.fn(async () => undefined),
  sendAdminPaymentNotificationEmail: vi.fn(async () => undefined),
}));

vi.mock("../../src/google-calendar/google-calendar.service.js", () => ({
  googleCalendarService: {
    createBookingEvent: vi.fn(async () => ({ eventId: null, eventUrl: null })),
  },
}));

describe.skipIf(!TEST_DATABASE_URL)("PostgreSQL: paid cancelled purchases", () => {
  let prisma: any;
  let membershipService: any;
  let paymentService: any;
  let paymentController: any;

  let userId: string;
  let current: any;
  let purchase: any;

  beforeAll(async () => {
    prisma = (await import("../../src/config/prisma.js")).default;
    membershipService = (await import("../../src/membership/membership.service.js")).default;
    paymentService = (await import("../../src/payment/payment.service.js")).default;
    paymentController = (await import("../../src/payment/payment.controller.js")).default;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    const tables: { tablename: string }[] = await prisma.$queryRaw`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    `;
    await prisma.$executeRawUnsafe(
      `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`
    );

    const user = await prisma.user.create({
      data: { fullName: "Test Member", email: "member@example.com", phone: "08000000000" },
    });
    userId = user.id;

    // Two admins, so de-duplication is checked per admin.
    for (const email of ["admin1@example.com", "admin2@example.com"]) {
      await prisma.user.create({ data: { fullName: "Admin", email, role: "ADMIN" } });
    }

    const monthly = await prisma.membership.create({
      data: { name: "Monthly", slug: "monthly", price: 50000, features: [], type: "GROUP", duration: "Monthly", period: "/month", classLimit: 8 },
    });
    const twoMonth = await prisma.membership.create({
      data: { name: "2 Months", slug: "two-month", price: 90000, features: [], type: "GROUP", duration: "2 Months", period: "/2 months", classLimit: 16 },
    });

    const now = new Date();
    const expiry = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 20));
    if (expiry.getUTCDate() > 28) expiry.setUTCDate(28);

    current = await prisma.memberMembership.create({
      data: {
        userId,
        membershipId: monthly.id,
        status: "ACTIVE",
        startDate: new Date(expiry.getTime() - 30 * 24 * 60 * 60 * 1000),
        expiryDate: expiry,
        creditsTotal: 8,
        creditsUsed: 3,
      },
    });

    // An upgrade superseded by a newer attempt, then paid anyway.
    purchase = await prisma.membershipPurchase.create({
      data: {
        userId,
        email: "member@example.com",
        fullName: "Test Member",
        membershipId: twoMonth.id,
        type: "UPGRADE",
        amount: 90000,
        paymentReference: `SL-PG-UPGRADE-${Date.now()}`,
        paymentStatus: "FAILED",
        previousMemberMembershipId: current.id,
      },
    });
  });

  function webhook(reference: string) {
    const body = Buffer.from(
      JSON.stringify({ event: "transaction.successful", data: { reference } })
    );
    const signature = crypto.createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
    return paymentService.handleWebhook(body, signature);
  }

  async function callback(reference: string) {
    const res: any = { redirect: vi.fn(), status: vi.fn(() => res), json: vi.fn(() => res) };
    await paymentController.callback(
      { query: { reference }, method: "GET", originalUrl: "/callback" },
      res
    );
    return res.redirect.mock.calls[0]?.[0] as string;
  }

  const reload = () =>
    prisma.membershipPurchase.findUnique({ where: { id: purchase.id } });

  it("concurrent webhook retries and the callback record it once and notify each admin once", async () => {
    const results = await Promise.allSettled([
      webhook(purchase.paymentReference),
      webhook(purchase.paymentReference),
      webhook(purchase.paymentReference),
      callback(purchase.paymentReference),
    ]);

    expect(results.map((r) => r.status)).toEqual([
      "fulfilled",
      "fulfilled",
      "fulfilled",
      "fulfilled",
    ]);
    for (const result of results.slice(0, 3)) {
      expect((result as PromiseFulfilledResult<any>).value).toMatchObject({
        received: true,
        reconciliationRequired: true,
      });
    }
    expect((results[3] as PromiseFulfilledResult<string>).value).toContain("payment=review");

    const after = await reload();
    expect(after.paymentStatus).toBe("FAILED");
    // Flagged exactly once (one marker, no nested "previous:" entries).
    expect(after.paymentRejectionReason.match(/PAID_NEEDS_RECONCILIATION/g)).toHaveLength(1);

    // One notification per admin, de-duplicated by the real unique key.
    expect(
      await prisma.adminNotification.count({
        where: { eventKey: `paid-failed-purchase:${purchase.paymentReference}` },
      })
    ).toBe(2);

    // Nothing applied.
    expect(await prisma.memberMembership.count({ where: { membershipPurchaseId: purchase.id } })).toBe(0);
    const stillCurrent = await prisma.memberMembership.findUnique({ where: { id: current.id } });
    expect(stillCurrent.status).toBe("ACTIVE");
  });

  it("an admin apply racing a webhook retry applies the purchase exactly once", async () => {
    await webhook(purchase.paymentReference);

    const results = await Promise.allSettled([
      membershipService.applyPaidFailedPurchase(purchase.id),
      webhook(purchase.paymentReference),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);

    expect((await reload()).paymentStatus).toBe("PAID");
    expect(await prisma.memberMembership.count({ where: { membershipPurchaseId: purchase.id } })).toBe(1);

    const active = await prisma.memberMembership.findMany({ where: { userId, status: "ACTIVE" } });
    expect(active).toHaveLength(1);
    // 16 new + 5 unused carried + 3 used kept.
    expect(active[0].creditsTotal).toBe(24);
    expect(active[0].creditsUsed).toBe(3);
  });

  it("a refund racing an apply: exactly one of them wins", async () => {
    await webhook(purchase.paymentReference);

    const [applied, refunded] = await Promise.allSettled([
      membershipService.applyPaidFailedPurchase(purchase.id),
      membershipService.markPaidFailedPurchaseRefunded(purchase.id, "Refunded"),
    ]);

    const after = await reload();
    const membershipCount = await prisma.memberMembership.count({
      where: { membershipPurchaseId: purchase.id },
    });

    if (applied.status === "fulfilled") {
      expect(refunded.status).toBe("rejected");
      expect(after.paymentStatus).toBe("PAID");
      expect(membershipCount).toBe(1);
    } else {
      expect(refunded.status).toBe("fulfilled");
      expect(after.paymentStatus).toBe("FAILED");
      expect(after.paymentRejectionReason).toMatch(/^RECONCILED_REFUNDED/);
      expect(membershipCount).toBe(0);
    }
  });
});
