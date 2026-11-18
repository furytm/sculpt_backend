/* eslint-disable @typescript-eslint/no-explicit-any -- services are imported dynamically after DATABASE_URL is set */
/**
 * Admin activity-log APIs against a REAL PostgreSQL database and the
 * REAL Express app (routes, authenticate, requireAdmin, controllers,
 * SQL filtering). Also the retention job and the deleted-member
 * fallback, which need real foreign keys.
 *
 * Skipped unless TEST_DATABASE_URL is set; see
 * tests/postgres/membership-concurrency.pg.test.ts for setup. Run the
 * postgres files with --no-file-parallelism.
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

describe.skipIf(!TEST_DATABASE_URL)("PostgreSQL: admin activity-log APIs", () => {
  let prisma: any;
  let app: any;
  let activityLog: any;
  let token: (user: any) => string;
  let admin: any;
  let member: any;
  let other: any;
  let tutor: any;

  const T0 = new Date("2026-11-01T10:00:00.000Z");
  const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

  const truncateAll = async () => {
    const tables: { tablename: string }[] = await prisma.$queryRaw`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    `;
    await prisma.$executeRawUnsafe(
      `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`
    );
  };

  const log = (data: Record<string, unknown>) =>
    prisma.memberActivityLog.create({
      data: { actorType: "MEMBER", stage: "SUCCEEDED", status: "SUCCESS", action: "booking", ...data },
    });

  const get = (path: string, user: any = admin) => {
    const call = request(app).get(path);
    return user ? call.set({ Authorization: `Bearer ${token(user)}` }) : call;
  };

  beforeAll(async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    prisma = (await import("../../src/config/prisma.js")).default;
    app = (await import("../../src/app.js")).default;
    activityLog = (await import("../../src/activity-log/activity-log.service.js")).activityLog;
    const { generateAccessToken } = await import("../../src/utils/jwt.js");
    token = (user) => generateAccessToken({ userId: user.id, email: user.email, role: user.role });
  }, 60_000);

  beforeEach(async () => {
    await truncateAll();
    const user = (email: string, role: string, fullName: string) =>
      prisma.user.create({ data: { email, role, fullName, password: "$2a$10$notarealhashbutlookslikeone" } });
    admin = await user("admin@example.com", "ADMIN", "Ada Admin");
    member = await user("mina@example.com", "MEMBER", "Mina Member");
    other = await user("otto@example.com", "MEMBER", "Otto Other");
    tutor = await user("tess@example.com", "TUTOR", "Tess Tutor");
  });

  afterAll(async () => {
    if (prisma) {
      await truncateAll();
      await prisma.$disconnect();
    }
  });

  // -------------------------------------------------------------------

  describe("authorization", () => {
    const paths = () => [
      "/api/admin/activity-logs",
      "/api/admin/activity-logs/errors",
      "/api/admin/activity-logs/operations/SL-1",
      `/api/admin/members/${member.id}/activity-logs`,
    ];

    it("unauthenticated requests are rejected (401)", async () => {
      for (const path of paths()) expect((await get(path, null)).status).toBe(401);
    });

    it("members and tutors are rejected (403)", async () => {
      for (const path of paths()) {
        expect((await get(path, member)).status).toBe(403);
        expect((await get(path, tutor)).status).toBe(403);
      }
    });

    it("admins can use every endpoint", async () => {
      await log({ userId: member.id, correlationId: "SL-1" });
      for (const path of paths()) expect((await get(path)).status).toBe(200);
    });
  });

  describe("GET /api/admin/activity-logs", () => {
    it("newest first, stable pagination with totals", async () => {
      for (let i = 0; i < 7; i += 1) {
        // Two events share each timestamp: ties are ordered by id.
        await log({ userId: member.id, createdAt: at(Math.floor(i / 2)), description: `event ${i}` });
      }

      const first = await get("/api/admin/activity-logs?limit=3&page=1");
      const second = await get("/api/admin/activity-logs?limit=3&page=2");
      const third = await get("/api/admin/activity-logs?limit=3&page=3");

      expect(first.body.data.pagination).toEqual({
        page: 1, limit: 3, total: 7, totalPages: 3, hasNextPage: true, hasPreviousPage: false,
      });
      const all = [...first.body.data.items, ...second.body.data.items, ...third.body.data.items];
      expect(all).toHaveLength(7);
      expect(new Set(all.map((item: any) => item.id)).size).toBe(7);
      const times = all.map((item: any) => new Date(item.occurredAt).getTime());
      expect([...times].sort((a, b) => b - a)).toEqual(times);
    });

    it("filters individually and together, in the database", async () => {
      await log({ userId: member.id, action: "booking", status: "SUCCESS", correlationId: "SL-A", requestId: "req-1", entityType: "BOOKING", entityId: "b1", createdAt: at(1) });
      await log({ userId: member.id, action: "booking.cancellation", status: "FAILURE", stage: "FAILED", errorCode: "REQUEST_REJECTED", httpStatus: 400, correlationId: "SL-A", entityType: "BOOKING", entityId: "b1", createdAt: at(2) });
      await log({ userId: other.id, action: "booking", status: "SUCCESS", correlationId: "SL-B", createdAt: at(3) });
      await log({ actorType: "ADMIN", actorUserId: admin.id, userId: member.id, action: "admin.membership.assign", createdAt: at(4) });
      await log({ actorType: "GUEST", subjectEmail: "guest@example.com", action: "membership.purchase", status: "INFO", stage: "INITIATED", paymentReference: "SL-GUEST-9", createdAt: at(5) });

      const ids = async (query: string) =>
        (await get(`/api/admin/activity-logs?${query}`)).body.data.items.map((item: any) => item.action + ":" + item.status);

      expect(await ids("status=FAILURE")).toEqual(["booking.cancellation:FAILURE"]);
      expect(await ids("action=booking")).toEqual(["booking:SUCCESS", "booking:SUCCESS"]);
      expect(await ids("action=booking,booking.cancellation")).toHaveLength(3);
      expect(await ids("actorType=ADMIN")).toEqual(["admin.membership.assign:SUCCESS"]);
      expect(await ids(`subjectUserId=${other.id}`)).toEqual(["booking:SUCCESS"]);
      expect(await ids("subjectEmail=GUEST@example.com")).toEqual(["membership.purchase:INFO"]);
      expect(await ids("entityType=BOOKING&entityId=b1")).toHaveLength(2);
      expect(await ids("correlationId=SL-A")).toHaveLength(2);
      expect(await ids("requestId=req-1")).toEqual(["booking:SUCCESS"]);
      expect(await ids("paymentReference=SL-GUEST-9")).toEqual(["membership.purchase:INFO"]);
      // Combined.
      expect(await ids(`subjectUserId=${member.id}&status=SUCCESS&action=booking`)).toEqual(["booking:SUCCESS"]);
      // Date range (inclusive).
      expect(await ids(`from=${at(2).toISOString()}&to=${at(3).toISOString()}`)).toEqual([
        "booking:SUCCESS",
        "booking.cancellation:FAILURE",
      ]);
      // Search: text fields, member names/emails, exact references.
      expect(await ids("search=otto")).toEqual(["booking:SUCCESS"]);
      expect(await ids("search=REQUEST_REJ")).toEqual(["booking.cancellation:FAILURE"]);
      expect(await ids("search=SL-GUEST")).toEqual(["membership.purchase:INFO"]);
    });

    it("exposes only safe fields: no passwords, no unknown metadata", async () => {
      await log({
        userId: member.id,
        actorType: "ADMIN",
        actorUserId: admin.id,
        metadata: { creditsRemaining: 5, password: "hunter2", token: "secret", rawBody: { card: "4111" } },
      });

      const response = await get("/api/admin/activity-logs");
      const [item] = response.body.data.items;

      expect(item.metadata).toEqual({ creditsRemaining: 5 });
      expect(item.actor).toEqual({ type: "ADMIN", userId: admin.id, name: "Ada Admin", email: "admin@example.com" });
      expect(item.subject).toMatchObject({ userId: member.id, name: "Mina Member", email: "mina@example.com", role: "MEMBER" });
      const text = JSON.stringify(response.body);
      expect(text).not.toMatch(/hunter2|secret|4111|notarealhash|password/i);
    });

    it("invalid filters get a safe 400", async () => {
      for (const query of [
        "limit=101",
        "page=0",
        "status=DONE",
        "actorType=ROBOT",
        "entityType=WIDGET",
        "from=not-a-date",
        `from=${at(5).toISOString()}&to=${at(1).toISOString()}`,
        "subjectUserId=" + encodeURIComponent("x' OR 1=1 --"),
        "correlationId=" + encodeURIComponent("<script>"),
        "unknownFilter=1",
        "search=" + "x".repeat(101),
      ]) {
        const response = await get(`/api/admin/activity-logs?${query}`);
        expect(response.status, query).toBe(400);
        expect(response.body).toMatchObject({ success: false, code: "VALIDATION_ERROR" });
        expect(response.body.requestId).toBe(response.headers["x-request-id"]);
        expect(JSON.stringify(response.body)).not.toMatch(/at \S+:\d+|prisma|stack/i);
      }
    });
  });

  describe("GET /api/admin/members/:memberId/activity-logs", () => {
    it("the member's own events, admin actions on them, and their pre-account guest events only", async () => {
      await log({ userId: member.id, action: "booking", createdAt: at(1) });
      await log({ actorType: "ADMIN", actorUserId: admin.id, userId: member.id, action: "admin.membership.assign", createdAt: at(2) });
      await log({ actorType: "GUEST", subjectEmail: "mina@example.com", action: "membership.purchase", createdAt: at(3) });
      await log({ userId: other.id, action: "booking", createdAt: at(4) });
      await log({ actorType: "GUEST", subjectEmail: "otto@example.com", action: "membership.purchase", createdAt: at(5) });

      const response = await get(`/api/admin/members/${member.id}/activity-logs`);

      expect(response.status).toBe(200);
      expect(response.body.data.member).toEqual({ id: member.id, fullName: "Mina Member", email: "mina@example.com", role: "MEMBER" });
      expect(response.body.data.items.map((item: any) => item.action)).toEqual([
        "membership.purchase",
        "admin.membership.assign",
        "booking",
      ]);
      expect(JSON.stringify(response.body)).not.toMatch(/otto/);
    });

    it("supports date, action, status filters and pagination", async () => {
      await log({ userId: member.id, action: "booking", status: "SUCCESS", createdAt: at(1) });
      await log({ userId: member.id, action: "booking", status: "FAILURE", stage: "FAILED", createdAt: at(2) });
      await log({ userId: member.id, action: "credit.deduction", createdAt: at(3) });

      const actions = async (query: string) =>
        (await get(`/api/admin/members/${member.id}/activity-logs?${query}`)).body.data.items.map((item: any) => `${item.action}:${item.status}`);

      expect(await actions("status=FAILURE")).toEqual(["booking:FAILURE"]);
      expect(await actions("action=credit.deduction")).toEqual(["credit.deduction:SUCCESS"]);
      expect(await actions(`to=${at(1).toISOString()}`)).toEqual(["booking:SUCCESS"]);
      const paged = await get(`/api/admin/members/${member.id}/activity-logs?limit=2&page=2`);
      expect(paged.body.data.items).toHaveLength(1);
      expect(paged.body.data.pagination.total).toBe(3);
    });

    it("cannot be used to read other members' events through filters", async () => {
      await log({ userId: other.id, action: "booking" });
      const response = await get(`/api/admin/members/${member.id}/activity-logs?subjectUserId=${other.id}`);
      expect(response.status).toBe(400); // not a supported filter here
    });

    it("unknown member: 404; malformed ID: 400", async () => {
      expect((await get("/api/admin/members/nonexistent123/activity-logs")).status).toBe(404);
      const bad = await get(`/api/admin/members/${encodeURIComponent("bad id!")}/activity-logs`);
      expect(bad.status).toBe(400);
      expect(bad.body.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("GET /api/admin/activity-logs/operations/:correlationId", () => {
    it("returns the operation's events in order, with a summary", async () => {
      await log({ userId: member.id, correlationId: "SL-OP-1", action: "membership.upgrade", stage: "INITIATED", status: "INFO", requestId: "r1", createdAt: at(1) });
      await log({ userId: member.id, correlationId: "SL-OP-1", action: "membership.upgrade", stage: "PAYMENT_INITIALIZED", status: "INFO", requestId: "r1", entityType: "MEMBERSHIP_PURCHASE", entityId: "p1", paymentReference: "SL-OP-1", createdAt: at(2) });
      await log({ userId: member.id, correlationId: "SL-OP-1", action: "payment.callback", stage: "VERIFIED", requestId: "r2", paymentReference: "SL-OP-1", createdAt: at(10) });
      await log({ userId: member.id, correlationId: "SL-OP-1", action: "membership.purchase_completion", stage: "SUCCEEDED", requestId: "r2", paymentReference: "SL-OP-1", entityType: "MEMBERSHIP_PURCHASE", entityId: "p1", createdAt: at(11) });
      await log({ userId: member.id, correlationId: "SL-OTHER", createdAt: at(5) });

      const response = await get("/api/admin/activity-logs/operations/SL-OP-1");
      const data = response.body.data;

      expect(response.status).toBe(200);
      expect(data.events.map((event: any) => event.stage)).toEqual(["INITIATED", "PAYMENT_INITIALIZED", "VERIFIED", "SUCCEEDED"]);
      expect(data).toMatchObject({
        correlationId: "SL-OP-1",
        eventCount: 4,
        latestStatus: "SUCCESS",
        hasFailures: false,
        paymentReferences: ["SL-OP-1"],
        requestIds: ["r1", "r2"],
        entities: [{ type: "MEMBERSHIP_PURCHASE", id: "p1" }],
        truncated: false,
      });
      expect(new Date(data.startedAt).getTime()).toBe(at(1).getTime());
      expect(new Date(data.endedAt).getTime()).toBe(at(11).getTime());
      expect(data.subjects).toEqual([expect.objectContaining({ userId: member.id })]);
    });

    it("unknown operation: clear 404; malformed ID: 400", async () => {
      const missing = await get("/api/admin/activity-logs/operations/SL-NOTHING");
      expect(missing.status).toBe(404);
      expect(missing.body).toMatchObject({ success: false, code: "NOT_FOUND", message: "No activity was found for this operation." });

      const bad = await get(`/api/admin/activity-logs/operations/${encodeURIComponent("a b")}`);
      expect(bad.status).toBe(400);
    });
  });

  describe("GET /api/admin/activity-logs/errors", () => {
    it("returns failures only (warnings on request), with error filters", async () => {
      await log({ userId: member.id, status: "SUCCESS" });
      await log({ userId: member.id, status: "WARNING", stage: "WARNING", errorCode: "NOTIFICATION_FAILED" });
      await log({ userId: member.id, status: "FAILURE", stage: "FAILED", errorCode: "PAYMENT_PROVIDER_ERROR", httpStatus: 502, action: "membership.upgrade", correlationId: "SL-E1", requestId: "re1", createdAt: at(1) });
      await log({ userId: other.id, status: "FAILURE", stage: "FAILED", errorCode: "REQUEST_REJECTED", httpStatus: 400, action: "booking", createdAt: at(2) });

      const codes = async (query = "") =>
        (await get(`/api/admin/activity-logs/errors?${query}`)).body.data.items.map((item: any) => item.error.code);

      expect(await codes()).toEqual(["REQUEST_REJECTED", "PAYMENT_PROVIDER_ERROR"]);
      expect(await codes("includeWarnings=true")).toHaveLength(3);
      expect(await codes("errorCode=PAYMENT_PROVIDER_ERROR")).toEqual(["PAYMENT_PROVIDER_ERROR"]);
      expect(await codes("httpStatus=400")).toEqual(["REQUEST_REJECTED"]);
      expect(await codes(`subjectUserId=${other.id}`)).toEqual(["REQUEST_REJECTED"]);
      expect(await codes("action=membership.upgrade&correlationId=SL-E1&requestId=re1")).toEqual(["PAYMENT_PROVIDER_ERROR"]);
      expect(await codes(`from=${at(2).toISOString()}`)).toEqual(["REQUEST_REJECTED"]);

      const bad = await get("/api/admin/activity-logs/errors?httpStatus=999");
      expect(bad.status).toBe(400);
    });

    it("includes errors no route handled, without stack traces", async () => {
      await request(app).post("/api/memberships/upgrade").set("Content-Type", "application/json").send("{bad json");
      await activityLog.flush();

      const response = await get("/api/admin/activity-logs/errors?action=system.unhandled_error");
      expect(response.body.data.items).toEqual([
        expect.objectContaining({ action: "system.unhandled_error", error: expect.objectContaining({ code: "INVALID_JSON", httpStatus: 400 }) }),
      ]);
      expect(JSON.stringify(response.body)).not.toMatch(/\bat \S+ \(|stack/);
    });
  });

  describe("real-database instrumentation", () => {
    it("deleting a member through the API still records the admin action (account link removed)", async () => {
      const response = await request(app)
        .delete(`/api/admin/members/${other.id}`)
        .set({ Authorization: `Bearer ${token(admin)}` });
      await activityLog.flush();

      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(await prisma.user.findUnique({ where: { id: other.id } })).toBeNull();
      const rows = await prisma.memberActivityLog.findMany({ where: { action: "admin.member.delete" } });
      expect(rows).toEqual([
        expect.objectContaining({ stage: "SUCCEEDED", actorUserId: admin.id, userId: null, entityType: "USER", entityId: other.id }),
      ]);
    });

    it("an event naming a member who no longer exists is kept without the link", async () => {
      activityLog.record({ action: "booking", stage: "INITIATED", status: "INFO", userId: "ghost_user_id" });
      await activityLog.flush();

      const rows = await prisma.memberActivityLog.findMany();
      expect(rows).toEqual([expect.objectContaining({ userId: null, entityType: "USER", entityId: "ghost_user_id" })]);
    });
  });

  describe("retention job", () => {
    const now = new Date("2027-06-01T00:00:00.000Z");
    const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

    beforeEach(async () => {
      await log({ status: "SUCCESS", createdAt: daysAgo(200), description: "old success" });
      await log({ status: "INFO", createdAt: daysAgo(181), description: "old info" });
      await log({ status: "SUCCESS", createdAt: daysAgo(10), description: "recent success" });
      await log({ status: "FAILURE", createdAt: daysAgo(200), description: "old-ish failure" });
      await log({ status: "FAILURE", createdAt: daysAgo(400), description: "very old failure" });
    });

    it("dry run (the default) only counts", async () => {
      const { purgeActivityLogs } = await import("../../src/activity-log/activity-log.retention.js");
      const result = await purgeActivityLogs({ now });

      expect(result).toMatchObject({ dryRun: true, matched: 3, deleted: 0, incomplete: false });
      expect(await prisma.memberActivityLog.count()).toBe(5);
    });

    it("applied: deletes exactly the expired rows, in batches; failures are kept longer", async () => {
      const { purgeActivityLogs } = await import("../../src/activity-log/activity-log.retention.js");
      const result = await purgeActivityLogs({ now, dryRun: false, batchSize: 2 });

      expect(result).toMatchObject({ dryRun: false, matched: 3, deleted: 3 });
      const left = (await prisma.memberActivityLog.findMany()).map((row: any) => row.description).sort();
      expect(left).toEqual(["old-ish failure", "recent success"]);
    });

    it("refuses unsafe windows", async () => {
      const { purgeActivityLogs } = await import("../../src/activity-log/activity-log.retention.js");
      await expect(purgeActivityLogs({ retentionDays: 7 })).rejects.toThrow(/at least 30/);
      await expect(purgeActivityLogs({ retentionDays: 200, failureRetentionDays: 100 })).rejects.toThrow(/must not be shorter/);
      expect(await prisma.memberActivityLog.count()).toBe(5);
    });
  });
});
