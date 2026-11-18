/* eslint-disable @typescript-eslint/no-explicit-any -- services are imported dynamically after DATABASE_URL is set */
/**
 * Member email change against a REAL PostgreSQL database and the REAL
 * Express app: real /api/auth/login cookies, real row locks, the real
 * unique index on User.email and the real EmailChangeRequest table from
 * the migration. Only the mailer is captured, to read the codes.
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

const mail = vi.hoisted(() => ({
  codes: [] as { to: string; code: string; purpose: string }[],
  notices: [] as { to: string; newEmail: string }[],
}));

vi.mock("../../src/utils/mailer.js", () => ({
  sendPasswordResetEmail: vi.fn(async () => undefined),
  sendVerificationEmail: vi.fn(async () => undefined),
  sendPaymentConfirmationEmail: vi.fn(async () => undefined),
  sendAdminPaymentNotificationEmail: vi.fn(async () => undefined),
  sendEmailChangeCodeEmail: vi.fn(async (data: any) => {
    mail.codes.push({ to: data.to, code: data.code, purpose: data.purpose });
  }),
  sendEmailChangedNoticeEmail: vi.fn(async (data: any) => {
    mail.notices.push({ to: data.to, newEmail: data.newEmail });
  }),
}));

const PASSWORD = "CorrectHorse1!";

describe.skipIf(!TEST_DATABASE_URL)("PostgreSQL: member email change", () => {
  let prisma: any;
  let app: any;
  let hashed = "";

  const truncateAll = async () => {
    const tables: { tablename: string }[] = await prisma.$queryRaw`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    `;
    await prisma.$executeRawUnsafe(
      `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`
    );
  };

  /** A member signed in through the real login route (cookies in the agent). */
  const signedInMember = async (email: string) => {
    const user = await prisma.user.create({
      data: { fullName: "Pat Member", email, password: hashed, role: "MEMBER", isEmailVerified: true },
    });
    const agent = request.agent(app);
    const login = await agent.post("/api/auth/login").send({ email, password: PASSWORD });
    expect(login.status).toBe(200);
    const refreshCookie = [].concat(login.headers["set-cookie"] as any)
      .find((c: string) => c.startsWith("refreshToken="))!
      .split(";")[0];
    return { user, agent, refreshCookie };
  };

  const codeFor = (to: string) => [...mail.codes].reverse().find((sent) => sent.to === to)!.code;

  /** Runs stage 1 for the member; afterwards a code has gone to newEmail. */
  const throughStageOne = async (member: any, currentEmail: string, newEmail: string) => {
    const started = await member.agent
      .post("/api/auth/email-change/request")
      .send({ newEmail, currentPassword: PASSWORD });
    expect(started.status).toBe(200);
    const verified = await member.agent
      .post("/api/auth/email-change/verify-current")
      .send({ code: codeFor(currentEmail) });
    expect(verified.status).toBe(200);
  };

  beforeAll(async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    prisma = (await import("../../src/config/prisma.js")).default;
    app = (await import("../../src/app.js")).default;
    hashed = await (await import("../../src/utils/bcrypt.js")).hashPassword(PASSWORD);
  }, 60_000);

  beforeEach(async () => {
    await truncateAll();
    mail.codes.length = 0;
    mail.notices.length = 0;
  });

  afterAll(async () => {
    if (prisma) {
      await truncateAll();
      await prisma.$disconnect();
    }
  });

  it("two members racing for the same new email: exactly one gets it", async () => {
    const amy = await signedInMember("amy@example.com");
    const ben = await signedInMember("ben@example.com");
    await throughStageOne(amy, "amy@example.com", "shared@example.com");
    await throughStageOne(ben, "ben@example.com", "shared@example.com");
    const code = codeFor("shared@example.com"); // ben's; amy's is earlier
    const amyCode = mail.codes.filter((sent) => sent.to === "shared@example.com")[0].code;

    const [a, b] = await Promise.all([
      amy.agent.post("/api/auth/email-change/verify-new").send({ code: amyCode }),
      ben.agent.post("/api/auth/email-change/verify-new").send({ code }),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.code).toBe("EMAIL_UNAVAILABLE");

    const owners = await prisma.user.findMany({ where: { email: "shared@example.com" } });
    expect(owners).toHaveLength(1);
    const loserId = owners[0].id === amy.user.id ? ben.user.id : amy.user.id;
    const loserRow = await prisma.user.findUnique({ where: { id: loserId } });
    expect(["amy@example.com", "ben@example.com"]).toContain(loserRow.email);
    expect(await prisma.emailChangeRequest.count()).toBe(0);
    expect(mail.notices).toHaveLength(1);
  }, 30_000);

  it("the same code submitted twice at once is used once, with one new session", async () => {
    const cara = await signedInMember("cara@example.com");
    await throughStageOne(cara, "cara@example.com", "cara.new@example.com");
    const code = codeFor("cara.new@example.com");

    const responses = await Promise.all([
      cara.agent.post("/api/auth/email-change/verify-new").send({ code }),
      cara.agent.post("/api/auth/email-change/verify-new").send({ code }),
    ]);

    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    const other = responses.find((r) => r.status !== 200)!;
    expect(["CODE_NO_LONGER_VALID", "NO_PENDING_REQUEST"]).toContain(other.body.code);

    const user = await prisma.user.findUnique({ where: { id: cara.user.id } });
    expect(user).toMatchObject({ email: "cara.new@example.com", isEmailVerified: true });
    expect(await prisma.refreshToken.count({ where: { userId: cara.user.id } })).toBe(1);
    expect(mail.notices).toEqual([{ to: "cara@example.com", newEmail: "cara.new@example.com" }]);

    // The login session's refresh token was revoked...
    const old = await request(app).post("/api/auth/refresh").set("Cookie", cara.refreshCookie);
    expect(old.status).toBe(401);

    // ...and logging in straight away (same second as the change, with no
    // wait) works with the new email only.
    const oldLogin = await request(app).post("/api/auth/login").send({ email: "cara@example.com", password: PASSWORD });
    expect(oldLogin.status).toBe(400);
    const newLogin = await request(app).post("/api/auth/login").send({ email: "cara.new@example.com", password: PASSWORD });
    expect(newLogin.status, JSON.stringify(newLogin.body)).toBe(200);
  }, 30_000);

  it("parallel wrong guesses never get more than 5 checks", async () => {
    const dan = await signedInMember("dan@example.com");
    await dan.agent
      .post("/api/auth/email-change/request")
      .send({ newEmail: "dan.new@example.com", currentPassword: PASSWORD });
    const right = codeFor("dan@example.com");
    const wrong = String((Number(right) + 1) % 1_000_000).padStart(6, "0");

    const responses = await Promise.all(
      Array.from({ length: 12 }, () =>
        dan.agent.post("/api/auth/email-change/verify-current").send({ code: wrong })
      )
    );

    expect(responses.some((r) => r.status === 200)).toBe(false);
    expect(responses.filter((r) => r.body.code === "INVALID_CODE").length).toBeLessThanOrEqual(4);
    expect(await prisma.emailChangeRequest.count()).toBe(0);

    const late = await dan.agent.post("/api/auth/email-change/verify-current").send({ code: right });
    expect(late.status).toBe(404);
    expect((await prisma.user.findUnique({ where: { id: dan.user.id } })).email).toBe("dan@example.com");
  }, 30_000);

  it("concurrent starts for one member leave a single request", async () => {
    const eve = await signedInMember("eve@example.com");

    const responses = await Promise.all([
      eve.agent.post("/api/auth/email-change/request").send({ newEmail: "eve.one@example.com", currentPassword: PASSWORD }),
      eve.agent.post("/api/auth/email-change/request").send({ newEmail: "eve.two@example.com", currentPassword: PASSWORD }),
    ]);

    expect(responses.some((r) => r.status === 200)).toBe(true);
    for (const response of responses) expect([200, 429]).toContain(response.status);

    const rows = await prisma.emailChangeRequest.findMany({ where: { userId: eve.user.id } });
    expect(rows).toHaveLength(1);

    // The surviving request accepts its own (latest) code.
    const ok = await eve.agent
      .post("/api/auth/email-change/verify-current")
      .send({ code: mail.codes[mail.codes.length - 1].code });
    const survivingCode = ok.status === 200 ? ok : null;
    if (!survivingCode) {
      // The other code was the one stored; it must then work.
      const other = await eve.agent
        .post("/api/auth/email-change/verify-current")
        .send({ code: mail.codes[0].code });
      expect(other.status).toBe(200);
    }
  }, 30_000);

  it("the migration's table: one request per member, removed with the member", async () => {
    const fay = await signedInMember("fay@example.com");
    await fay.agent
      .post("/api/auth/email-change/request")
      .send({ newEmail: "fay.new@example.com", currentPassword: PASSWORD });

    await expect(
      prisma.emailChangeRequest.create({
        data: { userId: fay.user.id, currentEmail: "fay@example.com", newEmail: "x@example.com", expiresAt: new Date() },
      })
    ).rejects.toMatchObject({ code: "P2002" });

    await prisma.user.delete({ where: { id: fay.user.id } });
    expect(await prisma.emailChangeRequest.count()).toBe(0);
  }, 30_000);
});
