/* eslint-disable @typescript-eslint/no-explicit-any -- services are imported dynamically after DATABASE_URL is set */
/**
 * Linking a legacy offline membership to its customer's account against
 * a REAL PostgreSQL database: the case-insensitive email match, and two
 * activation completions racing for the same activation. Real Prisma
 * client, row locks and unique keys.
 *
 * Skipped unless TEST_DATABASE_URL is set; see
 * tests/postgres/membership-concurrency.pg.test.ts for setup. Run the
 * postgres files with --no-file-parallelism, since they share the
 * database (every table is truncated).
 */
import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

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
  process.env.JWT_ACCESS_SECRET = "test-access-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
}

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

describe.skipIf(!TEST_DATABASE_URL)("PostgreSQL: legacy offline membership linking", () => {
  let prisma: any;
  let activationService: any;

  const EMAIL = "customer@example.com";
  const TOKEN = "a".repeat(64);
  const tokenHash = crypto.createHash("sha256").update(TOKEN).digest("hex");

  beforeAll(async () => {
    prisma = (await import("../../src/config/prisma.js")).default;
    activationService = (
      await import("../../src/membership-activation/membership-activation.service.js")
    ).membershipActivationService;
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
  });

  /** Legacy offline member: unlinked booking + membership + unused activation. */
  async function addLegacyMember() {
    const plan = await prisma.membership.create({
      data: { name: "Monthly", slug: "monthly", price: 50000, features: [], type: "GROUP", duration: "Monthly", period: "/month", classLimit: 10 },
    });
    const now = Date.now();
    const membership = await prisma.memberMembership.create({
      data: {
        membershipId: plan.id,
        status: "ACTIVE",
        startDate: new Date(now - 10 * 24 * 60 * 60 * 1000),
        expiryDate: new Date(now + 20 * 24 * 60 * 60 * 1000),
        creditsTotal: 10,
        creditsUsed: 4,
        membershipNumber: "SL-LEGACY-0001",
      },
    });
    const booking = await prisma.booking.create({
      data: {
        fullName: "Legacy Customer",
        email: EMAIL,
        membershipId: plan.id,
        memberMembershipId: membership.id,
        amount: 50000,
        paymentReference: "OFFLINE-LEGACY-1",
        paymentMethod: "OFFLINE",
        paymentStatus: "PAID",
        bookingStatus: "CONFIRMED",
      },
    });
    const activation = await prisma.membershipActivation.create({
      data: {
        bookingId: booking.id,
        memberMembershipId: membership.id,
        membershipNumber: "SL-LEGACY-0001",
        tokenHash,
        expiresAt: new Date(now + 7 * 24 * 60 * 60 * 1000),
      },
    });
    return { membership, booking, activation };
  }

  const complete = () =>
    activationService.completeActivation({
      membershipNumber: "SL-LEGACY-0001",
      activationToken: TOKEN,
      fullName: "Legacy Customer",
      password: "CorrectHorse1!",
    });

  it("an existing account with a differently-cased email gets the membership; no second account", async () => {
    const existing = await prisma.user.create({
      data: { fullName: "Registered", email: "Customer@Example.COM", password: "existing-hash" },
    });
    const { membership, booking } = await addLegacyMember();

    const result = await complete();

    expect(result.existingAccount).toBe(true);
    expect(result.user.id).toBe(existing.id);
    expect(await prisma.user.count()).toBe(1);
    expect((await prisma.booking.findUnique({ where: { id: booking.id } })).userId).toBe(existing.id);
    expect(await prisma.memberMembership.findUnique({ where: { id: membership.id } })).toMatchObject({
      userId: existing.id,
      creditsUsed: 4,
      status: "ACTIVE",
      membershipNumber: "SL-LEGACY-0001",
    });
    expect((await prisma.user.findUnique({ where: { id: existing.id } })).password).toBe("existing-hash");
  });

  it("two completions at once (no account yet): one account, linked once", async () => {
    for (let round = 0; round < 3; round += 1) {
      if (round > 0) {
        await prisma.refreshToken.deleteMany({});
        await prisma.membershipActivation.deleteMany({});
        await prisma.booking.deleteMany({});
        await prisma.memberMembership.deleteMany({});
        await prisma.membership.deleteMany({});
        await prisma.user.deleteMany({});
      }
      const { membership, activation } = await addLegacyMember();

      const results = await Promise.allSettled([complete(), complete()]);
      expect(results.some((r) => r.status === "fulfilled")).toBe(true);

      const users = await prisma.user.findMany();
      expect(users).toHaveLength(1);
      expect((await prisma.memberMembership.findUnique({ where: { id: membership.id } })).userId).toBe(users[0].id);
      expect((await prisma.membershipActivation.findUnique({ where: { id: activation.id } })).usedAt).not.toBeNull();
    }
  });

  it("two completions at once (existing account): linked once, nothing else created", async () => {
    const existing = await prisma.user.create({
      data: { fullName: "Registered", email: EMAIL, password: "existing-hash" },
    });
    const { membership } = await addLegacyMember();

    const results = await Promise.allSettled([complete(), complete()]);
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);

    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.memberMembership.count()).toBe(1);
    expect((await prisma.memberMembership.findUnique({ where: { id: membership.id } })).userId).toBe(existing.id);
  });
});
