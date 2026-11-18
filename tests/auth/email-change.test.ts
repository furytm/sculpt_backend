/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed fake rows and HTTP bodies */
/**
 * Member self-service email change, over HTTP against the real Express
 * app: real routes, real authenticate / requireMember middleware, real
 * JWTs and cookies, real bcrypt. Prisma is the in-memory fake and the
 * mailer is captured, so each test can read the codes that were "sent".
 *
 * Races that need real row locks and the real unique index are in
 * tests/postgres/email-change.pg.test.ts.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createFakePrisma } from "../helpers/fake-prisma";

process.env.JWT_ACCESS_SECRET = "test-access-secret";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
process.env.RESEND_API_KEY = "re_test_dummy";
process.env.FRONTEND_URL = "http://localhost:3000";

const fake = createFakePrisma();

vi.mock("../../src/config/prisma.js", () => ({ default: fake.prisma }));

const mail = vi.hoisted(() => ({
  codes: [] as { to: string; code: string; purpose: string; newEmail: string }[],
  notices: [] as { to: string; newEmail: string }[],
  failNextCode: false,
}));

vi.mock("../../src/utils/mailer.js", () => ({
  sendPasswordResetEmail: vi.fn(async () => undefined),
  sendVerificationEmail: vi.fn(async () => undefined),
  sendPaymentConfirmationEmail: vi.fn(async () => undefined),
  sendAdminPaymentNotificationEmail: vi.fn(async () => undefined),
  sendEmailChangeCodeEmail: vi.fn(async (data: any) => {
    if (mail.failNextCode) {
      mail.failNextCode = false;
      throw new Error("Resend is down");
    }
    mail.codes.push({ to: data.to, code: data.code, purpose: data.purpose, newEmail: data.newEmail });
  }),
  sendEmailChangedNoticeEmail: vi.fn(async (data: any) => {
    mail.notices.push({ to: data.to, newEmail: data.newEmail });
  }),
}));

const PASSWORD = "CorrectHorse1!";

let app: any;
let accessToken: (user: any) => string;
let passwordHash: string;

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  app = (await import("../../src/app.js")).default;
  const { generateAccessToken } = await import("../../src/utils/jwt.js");
  const { hashPassword } = await import("../../src/utils/bcrypt.js");
  passwordHash = await hashPassword(PASSWORD);
  accessToken = (user) =>
    generateAccessToken({ userId: user.id, email: user.email, role: user.role });
}, 60_000);

let member: any;

const addUser = (data: Record<string, unknown> = {}) =>
  fake.insert("user", {
    fullName: "Ada Member",
    email: `user${fake.tables.user.length + 1}@example.com`,
    password: passwordHash,
    phone: "08012345678",
    provider: "LOCAL",
    role: "MEMBER",
    isEmailVerified: false,
    avatar: null,
    ...data,
  });

beforeEach(() => {
  fake.reset();
  mail.codes.length = 0;
  mail.notices.length = 0;
  mail.failNextCode = false;
  member = addUser({ email: "ada@example.com" });
});

const auth = (user = member) => ({ Authorization: `Bearer ${accessToken(user)}` });

const api = {
  request: (body: any, user = member) =>
    request(app).post("/api/auth/email-change/request").set(auth(user)).send(body),
  verifyCurrent: (code: string, user = member) =>
    request(app).post("/api/auth/email-change/verify-current").set(auth(user)).send({ code }),
  verifyNew: (code: string, user = member) =>
    request(app).post("/api/auth/email-change/verify-new").set(auth(user)).send({ code }),
  resend: (user = member) => request(app).post("/api/auth/email-change/resend").set(auth(user)),
  cancel: (user = member) => request(app).delete("/api/auth/email-change").set(auth(user)),
};

const start = (newEmail = "ada.new@example.com") =>
  api.request({ newEmail, currentPassword: PASSWORD });

const lastCode = () => mail.codes[mail.codes.length - 1];
const pending = () => fake.tables.emailChangeRequest.find((row) => row.userId === member.id);
const wrongCode = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

/** Pretend the last code was sent long enough ago to allow a resend. */
const allowResend = () => {
  pending()!.lastSentAt = new Date(Date.now() - 2 * 60 * 1000);
};

describe("access control", () => {
  const everyEndpoint = (headers: Record<string, string>) => [
    request(app).post("/api/auth/email-change/request").set(headers).send({ newEmail: "x@example.com", currentPassword: PASSWORD }),
    request(app).post("/api/auth/email-change/verify-current").set(headers).send({ code: "123456" }),
    request(app).post("/api/auth/email-change/verify-new").set(headers).send({ code: "123456" }),
    request(app).post("/api/auth/email-change/resend").set(headers),
    request(app).delete("/api/auth/email-change").set(headers),
  ];

  it("refuses unauthenticated requests (401)", async () => {
    for (const response of await Promise.all(everyEndpoint({}))) {
      expect(response.status).toBe(401);
    }
    expect(mail.codes).toHaveLength(0);
    expect(fake.tables.emailChangeRequest).toHaveLength(0);
  });

  it("refuses ADMIN accounts (403 MEMBER_ONLY)", async () => {
    const admin = addUser({ email: "admin@example.com", role: "ADMIN" });
    for (const response of await Promise.all(everyEndpoint(auth(admin)))) {
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("MEMBER_ONLY");
    }
    expect(fake.get("user", admin.id).email).toBe("admin@example.com");
    expect(mail.codes).toHaveLength(0);
  });

  it("refuses TUTOR accounts (403)", async () => {
    const tutor = addUser({ email: "tutor@example.com", role: "TUTOR" });
    for (const response of await Promise.all(everyEndpoint(auth(tutor)))) {
      expect(response.status).toBe(403);
    }
    expect(fake.get("user", tutor.id).email).toBe("tutor@example.com");
    expect(mail.codes).toHaveLength(0);
  });

  it("refuses a MEMBER token for a user who is not a member in the database", async () => {
    const promoted = addUser({ email: "promoted@example.com", role: "ADMIN" });
    const staleMemberToken = { Authorization: `Bearer ${accessToken({ ...promoted, role: "MEMBER" })}` };
    const response = await request(app)
      .post("/api/auth/email-change/request")
      .set(staleMemberToken)
      .send({ newEmail: "x@example.com", currentPassword: PASSWORD });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe("MEMBER_ONLY");
  });
});

describe("starting a request", () => {
  it.each([
    [{}, "VALIDATION_ERROR"],
    [{ newEmail: "not-an-email", currentPassword: PASSWORD }, "VALIDATION_ERROR"],
    [{ newEmail: "", currentPassword: PASSWORD }, "VALIDATION_ERROR"],
    [{ newEmail: "ok@example.com", currentPassword: PASSWORD, extra: 1 }, "VALIDATION_ERROR"],
    [{ newEmail: "ok@example.com" }, "VALIDATION_ERROR"],
    [{ newEmail: "ADA@Example.com ", currentPassword: PASSWORD }, "EMAIL_UNCHANGED"],
  ])("rejects %j with %s", async (body, code) => {
    const response = await api.request(body);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, code });
    expect(mail.codes).toHaveLength(0);
    expect(fake.tables.emailChangeRequest).toHaveLength(0);
  });

  it("rejects an email that belongs to another account, whatever its case (409)", async () => {
    addUser({ email: "Taken@Example.com" });
    const response = await start("taken@example.com");
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("EMAIL_UNAVAILABLE");
    expect(response.body.message).not.toMatch(/taken@example\.com/i);
    expect(mail.codes).toHaveLength(0);
    expect(fake.tables.emailChangeRequest).toHaveLength(0);
  });

  it("rejects an incorrect current password", async () => {
    const response = await api.request({ newEmail: "ada.new@example.com", currentPassword: "wrong-password" });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("INVALID_PASSWORD");
    expect(mail.codes).toHaveLength(0);
    expect(fake.tables.emailChangeRequest).toHaveLength(0);
  });

  it("refuses a LOCAL account that has no password yet", async () => {
    const noPassword = addUser({ email: "nopass@example.com", password: null });
    const response = await api.request({ newEmail: "x@example.com", currentPassword: "anything" }, noPassword);
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("PASSWORD_NOT_SET");
  });

  it("sends the first code to the CURRENT email only, without changing the account", async () => {
    const response = await start();

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      stage: "VERIFY_CURRENT",
      newEmail: "ada.new@example.com",
      sentTo: "ada@example.com",
      attemptsRemaining: 5,
      sendsRemaining: 4,
    });
    expect(mail.codes).toEqual([
      expect.objectContaining({ to: "ada@example.com", purpose: "current", newEmail: "ada.new@example.com" }),
    ]);
    expect(lastCode().code).toMatch(/^\d{6}$/);
    expect(fake.get("user", member.id).email).toBe("ada@example.com");

    // Only a keyed hash of the code is stored.
    const row = pending()!;
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(lastCode().code);
  });

  it("does not keep a request when the code email cannot be sent (502)", async () => {
    mail.failNextCode = true;
    const response = await start();
    expect(response.status).toBe(502);
    expect(response.body.code).toBe("EMAIL_SEND_FAILED");
    expect(fake.tables.emailChangeRequest).toHaveLength(0);
  });

  it("a new request replaces the pending one, and the old code stops working", async () => {
    await start("first@example.com");
    const oldCode = lastCode().code;
    allowResend();

    expect((await start("second@example.com")).status).toBe(200);
    expect(fake.tables.emailChangeRequest).toHaveLength(1);
    expect(pending()!.newEmail).toBe("second@example.com");

    if (oldCode !== lastCode().code) {
      const response = await api.verifyCurrent(oldCode);
      expect(response.status).toBe(400);
      expect(response.body.code).toBe("INVALID_CODE");
    }
  });

  it("cannot be restarted within the resend cooldown", async () => {
    await start();
    const response = await start("other@example.com");
    expect(response.status).toBe(429);
    expect(response.body.code).toBe("RESEND_TOO_SOON");
    expect(response.body.data.retryAfterSeconds).toBeGreaterThan(0);
    expect(pending()!.newEmail).toBe("ada.new@example.com");
  });
});

describe("the full two-stage change", () => {
  it("changes the email only after both codes, notifies the old address and replaces the session", async () => {
    const oldRefresh = fake.insert("refreshToken", {
      token: "old-refresh-token-device-1",
      userId: member.id,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    fake.insert("refreshToken", {
      token: "old-refresh-token-device-2",
      userId: member.id,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const other = addUser({ email: "other@example.com" });
    fake.insert("refreshToken", {
      token: "someone-elses-token",
      userId: other.id,
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    await start();
    const currentCode = lastCode().code;

    // Stage 2 can't be skipped.
    const skipped = await api.verifyNew(currentCode);
    expect(skipped.status).toBe(409);
    expect(skipped.body.code).toBe("WRONG_STAGE");

    const stage1 = await api.verifyCurrent(currentCode);
    expect(stage1.status).toBe(200);
    expect(stage1.body.data).toMatchObject({ stage: "VERIFY_NEW", sentTo: "ada.new@example.com" });
    expect(lastCode()).toMatchObject({ to: "ada.new@example.com", purpose: "new" });
    expect(fake.get("user", member.id).email).toBe("ada@example.com"); // not yet

    const newCode = lastCode().code;
    const stage2 = await api.verifyNew(newCode);

    expect(stage2.status).toBe(200);
    expect(stage2.body.message).toBe("Your email address has been changed.");
    expect(stage2.body.data.user).toMatchObject({
      id: member.id,
      email: "ada.new@example.com",
      isEmailVerified: true,
      role: "MEMBER",
    });
    expect(stage2.body.data.user.password).toBeUndefined();

    const user = fake.get("user", member.id);
    expect(user).toMatchObject({ email: "ada.new@example.com", isEmailVerified: true });
    expect(fake.tables.emailChangeRequest).toHaveLength(0);
    expect(mail.notices).toEqual([{ to: "ada@example.com", newEmail: "ada.new@example.com" }]);

    // Session: both old refresh tokens revoked, exactly one new one, sent as cookies.
    const cookies: string[] = [].concat(stage2.headers["set-cookie"] as any);
    const cookie = (name: string) =>
      decodeURIComponent(cookies.find((c) => c.startsWith(`${name}=`))!.split(";")[0].split("=")[1]);
    expect(cookies.find((c) => c.startsWith("accessToken="))).toMatch(/HttpOnly/);
    const tokens = fake.tables.refreshToken.filter((row) => row.userId === member.id);
    expect(tokens.map((row) => row.token)).toEqual([cookie("refreshToken")]);
    expect(fake.tables.refreshToken.some((row) => row.token === "someone-elses-token")).toBe(true);

    // The new access token works and carries the new email.
    const me = await request(app).get("/api/auth/me").set("Cookie", `accessToken=${cookie("accessToken")}`);
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe("ada.new@example.com");

    // The old refresh token no longer works; the new one does.
    const oldRefreshed = await request(app).post("/api/auth/refresh").set("Cookie", `refreshToken=${oldRefresh.token}`);
    expect(oldRefreshed.status).toBe(401);
    const refreshed = await request(app).post("/api/auth/refresh").set("Cookie", `refreshToken=${cookie("refreshToken")}`);
    expect(refreshed.status).toBe(200);

    // Neither code can be used again.
    const reuseNew = await api.verifyNew(newCode);
    expect(reuseNew.status).toBe(404);
    expect(reuseNew.body.code).toBe("NO_PENDING_REQUEST");
    const reuseCurrent = await api.verifyCurrent(currentCode);
    expect(reuseCurrent.status).toBe(404);
  });

  it("the first code is single-use and is not accepted for the new email", async () => {
    await start();
    const currentCode = lastCode().code;
    expect((await api.verifyCurrent(currentCode)).status).toBe(200);

    const again = await api.verifyCurrent(currentCode);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("WRONG_STAGE");

    if (currentCode !== lastCode().code) {
      const crossStage = await api.verifyNew(currentCode);
      expect(crossStage.status).toBe(400);
      expect(crossStage.body.code).toBe("INVALID_CODE");
    }
    expect(fake.get("user", member.id).email).toBe("ada@example.com");
  });

  it("refuses the change if another account took the new email in the meantime", async () => {
    await start();
    await api.verifyCurrent(lastCode().code);
    addUser({ email: "ada.new@example.com" });

    const response = await api.verifyNew(lastCode().code);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("EMAIL_UNAVAILABLE");
    expect(fake.get("user", member.id).email).toBe("ada@example.com");
    expect(fake.tables.emailChangeRequest).toHaveLength(0);
    expect(mail.notices).toHaveLength(0);
  });

  it("refuses the change if the account email changed some other way meanwhile", async () => {
    await start();
    await api.verifyCurrent(lastCode().code);
    fake.get("user", member.id).email = "changed.by.staff@example.com";

    const response = await api.verifyNew(lastCode().code);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("REQUEST_INVALIDATED");
    expect(fake.get("user", member.id).email).toBe("changed.by.staff@example.com");
    expect(fake.tables.emailChangeRequest).toHaveLength(0);
  });

  it("keeps the verified first stage when the second code can't be sent, and resend recovers", async () => {
    await start();
    mail.failNextCode = true;
    const response = await api.verifyCurrent(lastCode().code);

    expect(response.status).toBe(502);
    expect(response.body.code).toBe("EMAIL_SEND_FAILED");
    expect(pending()!.stage).toBe("VERIFY_NEW");

    const resent = await api.resend();
    expect(resent.status).toBe(200);
    expect(lastCode()).toMatchObject({ to: "ada.new@example.com", purpose: "new" });
    expect((await api.verifyNew(lastCode().code)).status).toBe(200);
  });
});

describe("codes: wrong, expired, attempts and resends", () => {
  it("rejects an incorrect code and counts down the attempts", async () => {
    await start();
    const response = await api.verifyCurrent(wrongCode(lastCode().code));
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "INVALID_CODE", data: { attemptsRemaining: 4 } });
    expect(pending()!.stage).toBe("VERIFY_CURRENT");
  });

  it.each(["12345", "1234567", "abcdef", ""])("rejects a malformed code %j", async (code) => {
    await start();
    const response = await api.verifyCurrent(code);
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
    expect(pending()!.attempts).toBe(0);
  });

  it("rejects an expired code without using an attempt; a resent code works", async () => {
    await start();
    const expired = lastCode().code;
    pending()!.codeExpiresAt = new Date(Date.now() - 1000);

    const response = await api.verifyCurrent(expired);
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("CODE_EXPIRED");
    expect(pending()!.attempts).toBe(0);

    allowResend();
    expect((await api.resend()).status).toBe(200);
    const fresh = lastCode().code;
    if (fresh !== expired) {
      expect((await api.verifyCurrent(expired)).body.code).toBe("INVALID_CODE");
    }
    expect((await api.verifyCurrent(fresh)).status).toBe(200);
  });

  it("an expired request is refused (410) and removed", async () => {
    await start();
    pending()!.expiresAt = new Date(Date.now() - 1000);
    const response = await api.verifyCurrent(lastCode().code);
    expect(response.status).toBe(410);
    expect(response.body.code).toBe("REQUEST_EXPIRED");
    expect(fake.tables.emailChangeRequest).toHaveLength(0);
  });

  it("cancels the request after 5 incorrect codes; even the right code then fails", async () => {
    await start();
    const right = lastCode().code;
    const wrong = wrongCode(right);

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const response = await api.verifyCurrent(wrong);
      expect(response.body).toMatchObject({ code: "INVALID_CODE", data: { attemptsRemaining: 5 - attempt } });
    }

    const fifth = await api.verifyCurrent(wrong);
    expect(fifth.status).toBe(429);
    expect(fifth.body.code).toBe("TOO_MANY_ATTEMPTS");
    expect(fake.tables.emailChangeRequest).toHaveLength(0);

    const late = await api.verifyCurrent(right);
    expect(late.status).toBe(404);
    expect(fake.get("user", member.id).email).toBe("ada@example.com");
  });

  it("the attempt limit also applies to the new-email code, and resending doesn't reset it", async () => {
    await start();
    await api.verifyCurrent(lastCode().code);
    const wrong = wrongCode(lastCode().code);

    for (let attempt = 1; attempt <= 4; attempt += 1) await api.verifyNew(wrong);
    allowResend();
    expect((await api.resend()).status).toBe(200);

    const response = await api.verifyNew(wrongCode(lastCode().code));
    expect(response.status).toBe(429);
    expect(response.body.code).toBe("TOO_MANY_ATTEMPTS");
    expect(fake.get("user", member.id).email).toBe("ada@example.com");
  });

  it("enforces the resend cooldown and the per-stage send limit", async () => {
    await start();

    const tooSoon = await api.resend();
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.code).toBe("RESEND_TOO_SOON");
    expect(tooSoon.body.data.retryAfterSeconds).toBeGreaterThan(0);
    expect(mail.codes).toHaveLength(1);

    for (let send = 2; send <= 5; send += 1) {
      allowResend();
      const response = await api.resend();
      expect(response.status).toBe(200);
      expect(response.body.data.sendsRemaining).toBe(5 - send);
    }
    expect(mail.codes).toHaveLength(5);
    expect(mail.codes.every((sent) => sent.to === "ada@example.com")).toBe(true);

    allowResend();
    const limit = await api.resend();
    expect(limit.status).toBe(429);
    expect(limit.body.code).toBe("RESEND_LIMIT_REACHED");
    expect(mail.codes).toHaveLength(5);

    // Only the latest code works.
    const latest = mail.codes[4].code;
    for (const earlier of mail.codes.slice(0, 4).map((sent) => sent.code)) {
      if (earlier !== latest) {
        expect((await api.verifyCurrent(earlier)).body.code).toBe("INVALID_CODE");
        break;
      }
    }
    expect((await api.verifyCurrent(latest)).status).toBe(200);
  });

  it("resend with nothing pending is a 404", async () => {
    const response = await api.resend();
    expect(response.status).toBe(404);
    expect(response.body.code).toBe("NO_PENDING_REQUEST");
  });
});

describe("cancellation and invalidation", () => {
  it("cancelling removes the request and its codes", async () => {
    await start();
    const code = lastCode().code;

    const cancelled = await api.cancel();
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data).toEqual({ cancelled: true });
    expect(fake.tables.emailChangeRequest).toHaveLength(0);

    expect((await api.verifyCurrent(code)).status).toBe(404);

    const again = await api.cancel();
    expect(again.status).toBe(200);
    expect(again.body.data).toEqual({ cancelled: false });
  });

  it("cancelling during the second stage leaves the email unchanged", async () => {
    await start();
    await api.verifyCurrent(lastCode().code);
    const newCode = lastCode().code;
    await api.cancel();
    expect((await api.verifyNew(newCode)).status).toBe(404);
    expect(fake.get("user", member.id).email).toBe("ada@example.com");
  });

  it("one member cannot touch another member's request", async () => {
    await start();
    const code = lastCode().code;
    const other = addUser({ email: "other@example.com" });

    expect((await api.verifyCurrent(code, other)).status).toBe(404);
    expect((await api.cancel(other)).body.data).toEqual({ cancelled: false });
    expect(pending()).toBeDefined();
  });

  it("a password reset cancels a pending email change", async () => {
    await start();
    const { hashToken } = await import("../../src/utils/auth-token.js");
    fake.insert("passwordResetToken", {
      tokenHash: hashToken("reset-token"),
      userId: member.id,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const reset = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "reset-token", password: "NewPassword123", confirmPassword: "NewPassword123" });

    expect(reset.status).toBe(200);
    expect(fake.tables.emailChangeRequest).toHaveLength(0);
  });
});

describe("Google accounts", () => {
  it("are refused before any code is sent, and keep their Google email", async () => {
    const google = addUser({ email: "gina@gmail.com", provider: "GOOGLE", password: null, isEmailVerified: true });

    const response = await api.request({ newEmail: "gina@example.com" }, google);
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("GOOGLE_ACCOUNT");

    for (const followUp of [api.verifyCurrent("123456", google), api.verifyNew("123456", google), api.resend(google)]) {
      expect((await followUp).body.code).toBe("GOOGLE_ACCOUNT");
    }
    expect((await api.cancel(google)).status).toBe(200);

    expect(fake.get("user", google.id).email).toBe("gina@gmail.com");
    expect(mail.codes).toHaveLength(0);
    expect(fake.tables.emailChangeRequest).toHaveLength(0);
  });
});

describe("PATCH /api/auth/profile", () => {
  const patch = (body: any) => request(app).patch("/api/auth/profile").set(auth()).send(body);

  it.each([
    [{ email: "ada.new@example.com" }],
    [{ email: "ada@example.com", fullName: "Ada Lovelace" }],
    [{ fullName: "Ada Lovelace", phone: "08099999999", email: "" }],
  ])("rejects any email field: %j", async (body) => {
    const response = await patch(body);
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("EMAIL_CHANGE_REQUIRES_VERIFICATION");
    expect(response.body.success).toBe(false);
    expect(fake.get("user", member.id)).toMatchObject({
      email: "ada@example.com",
      fullName: "Ada Member",
      phone: "08012345678",
    });
  });

  it.each([
    [{}],
    [{ fullName: "" }],
    [{ fullName: "Al" }],
    [{ fullName: "x".repeat(101) }],
    [{ phone: "call me" }],
    [{ phone: "12" }],
    [{ role: "ADMIN" }],
    [{ fullName: "Ada Lovelace", isEmailVerified: true }],
  ])("rejects an invalid update without changing anything: %j", async (body) => {
    const response = await patch(body);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, code: "VALIDATION_ERROR" });
    expect(fake.get("user", member.id)).toMatchObject({
      fullName: "Ada Member",
      phone: "08012345678",
      role: "MEMBER",
      isEmailVerified: false,
    });
  });

  it("still updates the name and phone", async () => {
    const response = await patch({ fullName: "  Ada Lovelace ", phone: "+234 801 234 5679" });
    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Profile updated successfully.");
    expect(response.body.data.user).toMatchObject({ fullName: "Ada Lovelace", phone: "+234 801 234 5679" });
    expect(fake.get("user", member.id)).toMatchObject({ fullName: "Ada Lovelace", phone: "+234 801 234 5679" });
  });

  it("still allows clearing the phone number", async () => {
    const response = await patch({ phone: "" });
    expect(response.status).toBe(200);
    expect(fake.get("user", member.id).phone).toBe("");
  });

  it("still requires authentication", async () => {
    const response = await request(app).patch("/api/auth/profile").send({ fullName: "Ada Lovelace" });
    expect(response.status).toBe(401);
  });
});
