/* eslint-disable @typescript-eslint/no-explicit-any -- services are imported dynamically after DATABASE_URL is set */
/**
 * Tutor logins against a REAL PostgreSQL database and the REAL Express
 * app over HTTP: the real create-tutors.ts script (run as a separate
 * process, twice), real /api/auth/login cookies, real middleware and
 * routes. Nothing about authentication or authorization is stubbed.
 *
 * Skipped unless TEST_DATABASE_URL is set; see
 * tests/postgres/membership-concurrency.pg.test.ts for setup. Run the
 * postgres files with --no-file-parallelism, since they share the
 * database (every table is truncated).
 */
import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

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

const DAY = 24 * 60 * 60 * 1000;
const PASSWORD = "CorrectHorse1!";

/** Lagos calendar date `days` from today, as YYYY-MM-DD. */
const lagosDate = (days: number) =>
  new Date(Date.now() + 60 * 60 * 1000 + days * DAY).toISOString().slice(0, 10);

/** A class at 10:00 Lagos on that date, stored as the generator does. */
const classAt = (date: string) => new Date(`${date}T09:00:00.000Z`);

describe.skipIf(!TEST_DATABASE_URL)("PostgreSQL: tutor logins and access", () => {
  let prisma: any;
  let app: any;
  let hashPassword: (password: string) => Promise<string>;

  const startDate = lagosDate(0);
  const endDate = lagosDate(14);

  let scriptOutput = "";
  let credentials: Record<string, string> = {};
  let scheduleSnapshot: any[] = [];
  let memberSessionId = "";

  const runScript = () =>
    execSync("npx tsx prisma/create-tutors.ts", {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
      encoding: "utf8",
    });

  // One sign-in per account, reused: two logins for the same user within
  // the same second currently fail (identical refresh tokens; see report).
  const sessions = new Map<string, { agent: any; response: any }>();
  const login = async (email: string, password: string) => {
    if (!sessions.has(email)) {
      const agent = request.agent(app);
      const response = await agent.post("/api/auth/login").send({ email, password });
      sessions.set(email, { agent, response });
    }
    return sessions.get(email)!;
  };

  const schedule = (agent: any, query = "") =>
    agent.get(`/api/admin/tutor-schedule?startDate=${startDate}&endDate=${endDate}${query}`);

  beforeAll(async () => {
    prisma = (await import("../../src/config/prisma.js")).default;
    hashPassword = (await import("../../src/utils/bcrypt.js")).hashPassword;

    const tables: { tablename: string }[] = await prisma.$queryRaw`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    `;
    await prisma.$executeRawUnsafe(
      `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`
    );

    const hashed = await hashPassword(PASSWORD);
    await prisma.user.create({
      data: { fullName: "Admin", email: "admin@example.com", password: hashed, role: "ADMIN", isEmailVerified: true },
    });
    const member = await prisma.user.create({
      data: { fullName: "Mary Member", email: "mary@example.com", phone: "08011112222", password: hashed, role: "MEMBER", isEmailVerified: true },
    });
    const plan = await prisma.membership.create({
      data: { name: "Monthly", slug: "monthly", price: 50000, features: [], type: "GROUP", duration: "Monthly", period: "/month", classLimit: 10 },
    });
    await prisma.memberMembership.create({
      data: {
        userId: member.id,
        membershipId: plan.id,
        status: "ACTIVE",
        startDate: new Date(Date.now() - 5 * DAY),
        expiryDate: new Date(Date.now() + 25 * DAY),
        creditsTotal: 10,
        creditsUsed: 0,
      },
    });

    // Existing schedules identified only by tutorName, with harmless
    // differences, Betty, and one that names two tutors.
    const tutorNames = {
      H1: "Hope",
      H2: "  hope ",
      D1: "Daniel",
      D2: "DANIEL",
      B1: "Betty",
      X1: "Hope & Daniel",
    };
    let day = 2;
    for (const [code, tutorName] of Object.entries(tutorNames)) {
      const schedule = await prisma.schedule.create({
        data: { code, className: `Class ${code}`, tutorName, dayOfWeek: "MONDAY", startTime: "10:00", endTime: "11:00" },
      });
      const session = await prisma.classSession.create({
        data: { scheduleId: schedule.id, sessionDate: classAt(lagosDate(day++)) },
      });
      await prisma.booking.create({
        data: {
          fullName: member.fullName,
          email: member.email,
          phone: member.phone,
          userId: member.id,
          sessionId: session.id,
          scheduleId: schedule.id,
          membershipId: plan.id,
          amount: 0,
          paymentReference: `BOOKING-${code}`,
          paymentStatus: "PAID",
          bookingStatus: "CONFIRMED",
        },
      });
    }

    // A Betty session the member will book through the API.
    const bettyOpen = await prisma.schedule.create({
      data: { code: "B2", className: "Class B2", tutorName: "Betty", dayOfWeek: "MONDAY", startTime: "10:00", endTime: "11:00" },
    });
    memberSessionId = (
      await prisma.classSession.create({
        data: { scheduleId: bettyOpen.id, sessionDate: classAt(lagosDate(10)) },
      })
    ).id;

    scheduleSnapshot = await prisma.schedule.findMany({ orderBy: { code: "asc" } });

    scriptOutput = runScript();
    credentials = Object.fromEntries(
      [...scriptOutput.matchAll(/^\s+(\S+@sculptlab\.com)\s+(\S+)$/gm)].map((m) => [m[1], m[2]])
    );

    app = (await import("../../src/app.js")).default;
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  // -----------------------------------------------------------------
  // The setup script
  // -----------------------------------------------------------------

  it("creates Hope and Daniel (not Betty), links their schedules, and reports the rest", async () => {
    expect(Object.keys(credentials).sort()).toEqual(["daniel@sculptlab.com", "hope@sculptlab.com"]);
    for (const password of Object.values(credentials)) {
      expect(password).toMatch(/^[A-Za-z0-9_-]{24}$/);
    }

    expect(scriptOutput).toContain("Hope: linked 2 schedule(s)");
    expect(scriptOutput).toContain("Daniel: linked 2 schedule(s)");
    expect(scriptOutput).toMatch(/"Betty": 2 schedule\(s\)/);
    expect(scriptOutput).toMatch(/"Hope & Daniel": 1 schedule\(s\)/);

    const tutors = await prisma.tutor.findMany({ include: { user: true, schedules: true } });
    expect(tutors.map((t: any) => t.name).sort()).toEqual(["Daniel", "Hope"]);
    for (const tutor of tutors) {
      expect(tutor.user.role).toBe("TUTOR");
      expect(tutor.user.password).not.toBe(credentials[tutor.user.email]); // hashed
      expect(tutor.schedules).toHaveLength(2);
    }
    expect(await prisma.user.count({ where: { role: "TUTOR" } })).toBe(2);

    // Only tutorId changed on schedules; Betty's and the ambiguous one untouched.
    const after = await prisma.schedule.findMany({ orderBy: { code: "asc" } });
    // Compare everything except the two fields the backfill may set.
    const withoutLink = (schedule: any) =>
      Object.fromEntries(
        Object.entries(schedule).filter(([key]) => key !== "tutorId" && key !== "updatedAt")
      );
    after.forEach((row: any, index: number) => {
      expect(withoutLink(row)).toEqual(withoutLink(scheduleSnapshot[index]));
      if (["B1", "B2", "X1"].includes(row.code)) expect(row.tutorId).toBeNull();
    });
  });

  it("is safe to run again: nothing duplicated, no password reset", async () => {
    const before = await prisma.user.findMany({ where: { role: "TUTOR" }, orderBy: { email: "asc" } });

    const output = runScript();

    expect(output).not.toContain("New login credentials");
    expect(output).toContain("Login hope@sculptlab.com already exists");
    expect(output).toContain("Login daniel@sculptlab.com already exists");
    expect(output).toContain("Hope: linked 0 schedule(s); 2 already linked.");

    const after = await prisma.user.findMany({ where: { role: "TUTOR" }, orderBy: { email: "asc" } });
    expect(after.map((u: any) => u.password)).toEqual(before.map((u: any) => u.password));
    expect(await prisma.tutor.count()).toBe(2);
  }, 60_000);

  // -----------------------------------------------------------------
  // Admin and member behaviour unchanged
  // -----------------------------------------------------------------

  it("admin logs in and still sees every tutor's schedule, with member contact details", async () => {
    const { agent, response } = await login("admin@example.com", PASSWORD);
    expect(response.status).toBe(200);
    expect(response.body.data.user.role).toBe("ADMIN");

    const result = await schedule(agent);
    expect(result.status).toBe(200);
    const tutors = result.body.data.map((row: any) => row.tutor).sort();
    expect(tutors).toEqual(["  hope ", "Betty", "DANIEL", "Daniel", "Hope", "Hope & Daniel"]);
    expect(result.body.data[0].customer).toMatchObject({
      name: "Mary Member",
      email: "mary@example.com",
      phone: "08011112222",
    });

    expect((await agent.get("/api/admin/dashboard")).status).toBe(200);
    expect((await agent.get("/api/admin/members")).status).toBe(200);
  });

  it("member logs in and books a session as before", async () => {
    const { agent, response } = await login("mary@example.com", PASSWORD);
    expect(response.status).toBe(200);
    expect(response.body.data.user.role).toBe("MEMBER");

    const booked = await agent
      .post("/api/bookings/member-session")
      .send({ classSessionId: memberSessionId, healthDeclaration: { accepted: true }, bookingType: "GROUP" });
    expect(booked.status).toBe(201);
    expect((await agent.get("/api/bookings/my")).status).toBe(200);

    // A member is still refused the tutor schedule, with the same message.
    const refused = await schedule(agent);
    expect(refused.status).toBe(403);
    expect(refused.body.message).toBe("Admin access required.");
  });

  // -----------------------------------------------------------------
  // Tutors
  // -----------------------------------------------------------------

  for (const [name, email, own, other] of [
    ["Hope", "hope@sculptlab.com", "hope", "daniel"],
    ["Daniel", "daniel@sculptlab.com", "daniel", "hope"],
  ] as const) {
    it(`${name} logs in through /api/auth/login as TUTOR and sees only their own schedule, without contact details`, async () => {
      const { agent, response } = await login(email, credentials[email]);
      expect(response.status).toBe(200);
      expect(response.body.data.user.role).toBe("TUTOR");

      const cookie = String(response.headers["set-cookie"]).match(/accessToken=([^;]+)/)![1];
      const claims: any = jwt.decode(cookie);
      expect(claims).toMatchObject({ email, role: "TUTOR" });
      expect(claims.userId).toBeTruthy();

      const linked = await prisma.tutor.findUnique({ where: { userId: claims.userId } });
      expect(linked.name).toBe(name);

      expect((await agent.get("/api/auth/me")).status).toBe(200);

      const result = await schedule(agent);
      expect(result.status).toBe(200);
      expect(result.body.data).toHaveLength(2);
      for (const row of result.body.data) {
        expect(row.tutor.trim().toLowerCase()).toBe(own);
        expect(Object.keys(row.customer).sort()).toEqual(["id", "name"]);
        expect(JSON.stringify(row)).not.toContain("mary@example.com");
        expect(JSON.stringify(row)).not.toContain("08011112222");
      }
    });

    it(`${name} cannot get ${other === "daniel" ? "Daniel" : "Hope"}'s schedule by changing the request`, async () => {
      const { agent } = await login(email, credentials[email]);
      const otherTutor = await prisma.tutor.findFirst({ where: { name: { equals: other, mode: "insensitive" } } });

      for (const query of [
        `&tutorId=${otherTutor.id}`,
        `&tutorName=${other}`,
        `&tutor=${other}`,
        `&userId=${otherTutor.userId}`,
      ]) {
        const result = await schedule(agent, query);
        expect(result.status).toBe(200);
        expect(result.body.data.every((row: any) => row.tutor.trim().toLowerCase() === own)).toBe(true);
      }

      const withBody = await agent
        .get(`/api/admin/tutor-schedule?startDate=${startDate}&endDate=${endDate}`)
        .send({ tutorId: otherTutor.id });
      expect(withBody.body.data.every((row: any) => row.tutor.trim().toLowerCase() === own)).toBe(true);

      const casedPath = await agent.get(`/API/Admin/Tutor-Schedule?startDate=${startDate}&endDate=${endDate}&tutorId=${otherTutor.id}`);
      expect(casedPath.body.data.every((row: any) => row.tutor.trim().toLowerCase() === own)).toBe(true);
    });
  }

  it("tutors are refused admin, booking, membership, payment and profile APIs, and can't change schedules", async () => {
    const { agent } = await login("hope@sculptlab.com", credentials["hope@sculptlab.com"]);
    const session = await prisma.classSession.findFirst({ where: { schedule: { code: "H1" } } });

    const attempts = [
      agent.get("/api/admin/dashboard"),
      agent.get("/api/admin/members"),
      agent.get("/api/admin/bookings"),
      agent.get("/api/admin/sessions"),
      agent.post(`/api/admin/sessions/${session.id}/cancel`),
      agent.post(`/api/admin/sessions/${session.id}/offline-attendees`).send({ fullName: "X", membershipId: "x" }),
      agent.get("/api/admin/membership-purchases"),
      agent.get("/api/admin/notifications"),
      agent.post("/api/admin/resend-registration-email").send({ email: "mary@example.com" }),
      agent.post("/api/bookings/member-session").send({ classSessionId: session.id, healthDeclaration: { accepted: true }, bookingType: "GROUP" }),
      agent.get("/api/bookings/my"),
      agent.get("/api/bookings/my/credits"),
      agent.post("/api/memberships/upgrade").send({ membershipId: "x" }),
      agent.post("/api/memberships/renew").send({}),
      agent.post("/api/memberships/purchase").send({ membershipId: "x" }),
      agent.patch("/api/auth/profile").send({ fullName: "Changed" }),
    ];

    for (const response of await Promise.all(attempts)) {
      expect({ path: response.req.path, status: response.status }).toEqual({
        path: response.req.path,
        status: 403,
      });
      expect(response.body.message).toBe("Tutor accounts can only view their own tutor schedule.");
    }

    expect((await prisma.classSession.findUnique({ where: { id: session.id } })).status).toBe("OPEN");
    expect((await prisma.user.findUnique({ where: { email: "hope@sculptlab.com" } })).fullName).toBe("Hope");
  });

  it("a TUTOR account not linked to a tutor sees nothing", async () => {
    await prisma.user.create({
      data: { fullName: "Unlinked", email: "unlinked@example.com", password: await hashPassword(PASSWORD), role: "TUTOR", isEmailVerified: true },
    });
    const { agent } = await login("unlinked@example.com", PASSWORD);

    const result = await schedule(agent);
    expect(result.status).toBe(403);
    expect(result.body.message).toBe("This tutor account is not linked to a tutor.");
  });
});
