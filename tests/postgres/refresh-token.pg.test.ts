/* eslint-disable @typescript-eslint/no-explicit-any -- services are imported dynamically after DATABASE_URL is set */
/**
 * Refresh tokens against a REAL PostgreSQL database and the REAL Express
 * app: immediate consecutive logins (same second) no longer collide on
 * the unique RefreshToken.token, and rotation, logout and password-reset
 * revocation behave as before.
 *
 * Skipped unless TEST_DATABASE_URL is set; see
 * tests/postgres/membership-concurrency.pg.test.ts for setup. Run the
 * postgres files with --no-file-parallelism, since they share the
 * database (every table is truncated).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

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
  process.env.RESEND_API_KEY = "re_test_dummy";
  process.env.FRONTEND_URL = "http://localhost:3000";
}

vi.mock("../../src/utils/mailer.js", () => ({
  sendPasswordResetEmail: vi.fn(async () => undefined),
  sendVerificationEmail: vi.fn(async () => undefined),
  sendPaymentConfirmationEmail: vi.fn(async () => undefined),
  sendAdminPaymentNotificationEmail: vi.fn(async () => undefined),
  sendEmailChangeCodeEmail: vi.fn(async () => undefined),
  sendEmailChangedNoticeEmail: vi.fn(async () => undefined),
}));

const PASSWORD = "CorrectHorse1!";
const EMAIL = "rita@example.com";

const refreshCookie = (response: any) =>
  ([].concat(response.headers["set-cookie"] as any) as string[])
    .find((cookie) => cookie.startsWith("refreshToken="))!
    .split(";")[0];

describe.skipIf(!TEST_DATABASE_URL)("PostgreSQL: refresh tokens", () => {
  let prisma: any;
  let app: any;
  let user: any;

  const truncateAll = async () => {
    const tables: { tablename: string }[] = await prisma.$queryRaw`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    `;
    await prisma.$executeRawUnsafe(
      `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`
    );
  };

  const login = () => request(app).post("/api/auth/login").send({ email: EMAIL, password: PASSWORD });
  const refresh = (cookie: string) => request(app).post("/api/auth/refresh").set("Cookie", cookie);

  beforeAll(async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    prisma = (await import("../../src/config/prisma.js")).default;
    app = (await import("../../src/app.js")).default;
  }, 60_000);

  beforeEach(async () => {
    await truncateAll();
    const { hashPassword } = await import("../../src/utils/bcrypt.js");
    user = await prisma.user.create({
      data: { fullName: "Rita Member", email: EMAIL, password: await hashPassword(PASSWORD), role: "MEMBER", isEmailVerified: true },
    });
  });

  afterAll(async () => {
    if (prisma) {
      await truncateAll();
      await prisma.$disconnect();
    }
  });

  it("immediate consecutive logins (same second) all succeed with distinct tokens", async () => {
    const sequential = [await login(), await login(), await login()];
    const parallel = await Promise.all([login(), login(), login()]);
    const responses = [...sequential, ...parallel];

    for (const response of responses) expect(response.status, JSON.stringify(response.body)).toBe(200);

    const cookies = responses.map(refreshCookie);
    expect(new Set(cookies).size).toBe(6);
    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(6);
  }, 30_000);

  it("rotation still works: the used token is revoked, other sessions keep theirs", async () => {
    const deviceA = refreshCookie(await login());
    const deviceB = refreshCookie(await login());

    const rotated = await refresh(deviceA);
    expect(rotated.status).toBe(200);
    const deviceA2 = refreshCookie(rotated);
    expect(deviceA2).not.toBe(deviceA);

    expect((await refresh(deviceA)).status).toBe(401); // old token revoked
    expect((await refresh(deviceA2)).status).toBe(200); // rotated again, immediately
    expect((await refresh(deviceB)).status).toBe(200);
    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(2);
  }, 30_000);

  it("logout still revokes that session's token only", async () => {
    const deviceA = refreshCookie(await login());
    const deviceB = refreshCookie(await login());

    const loggedOut = await request(app).post("/api/auth/logout").set("Cookie", deviceA);
    expect(loggedOut.status).toBe(200);

    expect((await refresh(deviceA)).status).toBe(401);
    expect((await refresh(deviceB)).status).toBe(200);
  }, 30_000);

  it("password reset still revokes every session", async () => {
    const deviceA = refreshCookie(await login());
    const deviceB = refreshCookie(await login());

    const { hashToken } = await import("../../src/utils/auth-token.js");
    await prisma.passwordResetToken.create({
      data: { tokenHash: hashToken("reset-token"), userId: user.id, expiresAt: new Date(Date.now() + 60_000) },
    });
    const reset = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "reset-token", password: "NewPassword123", confirmPassword: "NewPassword123" });
    expect(reset.status).toBe(200);

    expect((await refresh(deviceA)).status).toBe(401);
    expect((await refresh(deviceB)).status).toBe(401);
    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(0);
  }, 30_000);

  it("a forged token for a stored session is still refused", async () => {
    const real = refreshCookie(await login());
    const jwt = (await import("jsonwebtoken")).default;
    const forged = jwt.sign({ userId: user.id, email: EMAIL, role: "MEMBER" }, "wrong-secret", { jwtid: "x" });
    expect((await refresh(`refreshToken=${forged}`)).status).toBe(401);
    expect((await refresh(real)).status).toBe(200);
  }, 30_000);
});
