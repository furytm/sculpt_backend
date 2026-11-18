/* eslint-disable @typescript-eslint/no-explicit-any -- services are imported dynamically after DATABASE_URL is set */
/**
 * Health & Safety revision history, member and admin endpoints, admin
 * membership plans, and notifications, against a REAL PostgreSQL
 * database (real migration, transactions, foreign keys) and the REAL
 * Express app. Only the mailer and web-push are stubbed.
 *
 * Skipped unless TEST_DATABASE_URL is set; see
 * tests/postgres/membership-concurrency.pg.test.ts for setup. Run the
 * postgres files with --no-file-parallelism.
 */
import fs from "node:fs";
import path from "node:path";
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
  // Test-only push configuration (web-push itself is mocked).
  process.env.VAPID_SUBJECT = "mailto:test@example.com";
  process.env.VAPID_PUBLIC_KEY = "test-public-key";
  process.env.VAPID_PRIVATE_KEY = "test-private-key";
}

const push = vi.hoisted(() => ({ sent: [] as any[] }));
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(async (_subscription: unknown, payload: string) => {
      push.sent.push(JSON.parse(payload));
    }),
  },
}));

vi.mock("../../src/utils/mailer.js", () => ({
  sendPasswordResetEmail: vi.fn(async () => undefined),
  sendVerificationEmail: vi.fn(async () => undefined),
  sendPaymentConfirmationEmail: vi.fn(async () => undefined),
  sendAdminPaymentNotificationEmail: vi.fn(async () => undefined),
  sendEmailChangeCodeEmail: vi.fn(async () => undefined),
  sendEmailChangedNoticeEmail: vi.fn(async () => undefined),
}));

const SECRET_NOTE = "Knee surgery in March; asthma inhaler SECRET-HEALTH-NOTE";

describe.skipIf(!TEST_DATABASE_URL)("PostgreSQL: Health & Safety", () => {
  let prisma: any;
  let app: any;
  let activityLog: any;
  let notificationService: any;
  let token: (user: any) => string;
  let admin: any;
  let member: any;
  let other: any;
  let tutor: any;
  let plan: any;

  const truncateAll = async () => {
    const tables: { tablename: string }[] = await prisma.$queryRaw`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    `;
    await prisma.$executeRawUnsafe(
      `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`
    );
  };

  const as = (user: any) => ({ Authorization: `Bearer ${token(user)}` });
  const mine = (user: any = member) => request(app).get("/api/members/me/health-safety").set(as(user));
  const update = (body: any, user: any = member) =>
    request(app).patch("/api/members/me/health-safety").set(as(user)).send(body);

  let bookingCount = 0;
  /** A booking with a declaration, made at checkout (no revision yet). */
  async function bookingWithForm(owner: any, overrides: { notes?: string | null; status?: string; createdAt?: Date } = {}) {
    bookingCount += 1;
    const schedule = await prisma.schedule.create({
      data: { code: `C${bookingCount}`, className: "Reformer", tutorName: "Tess", dayOfWeek: "MONDAY", startTime: "10:00", endTime: "11:00" },
    });
    const session = await prisma.classSession.create({
      data: { scheduleId: schedule.id, sessionDate: new Date(Date.now() + (5 + bookingCount) * 86_400_000) },
    });
    const booking = await prisma.booking.create({
      data: {
        fullName: owner?.fullName ?? "Gail Guest",
        email: owner?.email ?? "gail@example.com",
        phone: owner?.phone ?? "08077778888",
        userId: owner?.id ?? null,
        membershipId: plan.id,
        sessionId: session.id,
        scheduleId: schedule.id,
        classId: "Reformer",
        amount: 0,
        paymentReference: `SL-HS-${bookingCount}`,
        paymentStatus: "PAID",
        paymentMethod: "OFFLINE",
        bookingStatus: overrides.status ?? "CONFIRMED",
      },
    });
    const submittedAt = overrides.createdAt ?? new Date(Date.now() - (100 - bookingCount) * 60_000);
    const form = await prisma.healthSafetyForm.create({
      data: {
        bookingId: booking.id,
        userId: owner?.id ?? null,
        accepted: true,
        declarationVersion: "1.0",
        notes: overrides.notes === undefined ? "Original checkout note" : overrides.notes,
        acceptedAt: submittedAt,
        submittedAt,
        createdAt: submittedAt,
      },
    });
    return { booking, form, session };
  }

  beforeAll(async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    prisma = (await import("../../src/config/prisma.js")).default;
    app = (await import("../../src/app.js")).default;
    activityLog = (await import("../../src/activity-log/activity-log.service.js")).activityLog;
    notificationService = (await import("../../src/admin/admin-notification.service.js")).adminNotificationService;
    const { generateAccessToken } = await import("../../src/utils/jwt.js");
    token = (user) => generateAccessToken({ userId: user.id, email: user.email, role: user.role });
  }, 60_000);

  beforeEach(async () => {
    // Activity-log writes are non-blocking by design: let the previous
    // test's writes finish before truncating the tables they use.
    await activityLog.flush();
    await truncateAll();
    push.sent.length = 0;
    const user = (email: string, role: string, fullName: string, phone: string) =>
      prisma.user.create({ data: { email, role, fullName, phone, password: "$2a$10$hashhashhash" } });
    admin = await user("admin@example.com", "ADMIN", "Ada Admin", "08000000001");
    member = await user("mina@example.com", "MEMBER", "Mina Member", "08000000002");
    other = await user("otto@example.com", "MEMBER", "Otto Other", "08000000003");
    tutor = await user("tess@example.com", "TUTOR", "Tess Tutor", "08000000004");
    await prisma.adminPushSubscription.create({
      data: { adminId: admin.id, endpoint: "https://push.test/admin", p256dh: "p", auth: "a" },
    });
    plan = await prisma.membership.create({
      data: { name: "Monthly", slug: "monthly", type: "GROUP", price: 50000, period: "/month", classLimit: 8, duration: "Monthly", features: [] },
    });
  });

  afterAll(async () => {
    if (prisma) {
      await truncateAll();
      await prisma.$disconnect();
    }
  });

  // -------------------------------------------------------------------

  describe("migration backfill", () => {
    it("creates exactly one BACKFILL revision per existing declaration, with its own time and member", async () => {
      const { form: memberForm, booking } = await bookingWithForm(member);
      const { form: guestForm } = await bookingWithForm(null, { notes: null });
      // A form not linked to the account, on the member's booking.
      const { form: unlinked } = await bookingWithForm(other);
      await prisma.healthSafetyForm.update({ where: { id: unlinked.id }, data: { userId: null } });

      const sql = fs.readFileSync(
        path.join(process.cwd(), "prisma/migrations/20261118120000_add_health_safety_revisions/migration.sql"),
        "utf8"
      );
      const backfill = sql.slice(sql.indexOf("-- Backfill:start"), sql.indexOf("-- Backfill:end"));
      expect(backfill).toContain("INSERT INTO \"HealthSafetyRevision\"");
      await prisma.$executeRawUnsafe(backfill);

      const rows = await prisma.healthSafetyRevision.findMany({ orderBy: { createdAt: "asc" } });
      expect(rows).toHaveLength(3);
      expect(rows.every((row: any) => row.source === "BACKFILL" && row.kind === "BOOKING" && row.actorType === "SYSTEM")).toBe(true);

      const byForm = new Map(rows.map((row: any) => [row.formId, row]));
      expect(byForm.get(memberForm.id)).toMatchObject({
        userId: member.id,
        bookingId: booking.id,
        accepted: true,
        notes: "Original checkout note",
        declarationVersion: "1.0",
        createdAt: memberForm.submittedAt,
      });
      expect(byForm.get(guestForm.id)).toMatchObject({ userId: null, notes: null });
      expect(byForm.get(unlinked.id)).toMatchObject({ userId: other.id });
      // Existing tables untouched.
      expect(await prisma.healthSafetyForm.count()).toBe(3);
    });
  });

  describe("member GET / PATCH /api/members/me/health-safety", () => {
    it("requires a signed-in member (401 / 403 for admin and tutor)", async () => {
      expect((await request(app).get("/api/members/me/health-safety")).status).toBe(401);
      expect((await request(app).patch("/api/members/me/health-safety").send({ accepted: true })).status).toBe(401);
      for (const user of [admin, tutor]) {
        expect((await mine(user)).status).toBe(403);
        expect((await update({ accepted: true }, user)).status).toBe(403);
      }
    });

    it("no declaration yet: GET returns nulls (200)", async () => {
      const response = await mine();
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true, data: { current: null, revisions: [], declarations: [] } });
    });

    it("a member with no booking can declare: member-level revisions, earlier ones unchanged", async () => {
      const first = await update({ accepted: true, notes: "First note" });
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      expect(first.body.data.current).toMatchObject({ kind: "MEMBER", formId: null, bookingId: null, notes: "First note", accepted: true, declarationVersion: "1.0", revisionCount: 1 });
      const firstRevision = await prisma.healthSafetyRevision.findUnique({ where: { id: first.body.data.revisionId } });

      const second = await update({ accepted: true, notes: "Second note" });
      expect(second.body.data.current).toMatchObject({ kind: "MEMBER", notes: "Second note", revisionCount: 2 });
      expect(second.body.data.revisions.map((row: any) => row.notes)).toEqual(["Second note", "First note"]);

      // The first revision is exactly as it was.
      expect(await prisma.healthSafetyRevision.findUnique({ where: { id: firstRevision.id } })).toEqual(firstRevision);
      // No booking, form or purchase invented.
      expect(await prisma.booking.count()).toBe(0);
      expect(await prisma.healthSafetyForm.count()).toBe(0);
      expect(await prisma.membershipPurchase.count()).toBe(0);
    });

    it("updates the member-level declaration and every upcoming booking: baselines kept, forms updated, history grows", async () => {
      const { form: olderForm } = await bookingWithForm(member, { notes: "Old booking note" });
      const { form, booking } = await bookingWithForm(member, { notes: "Checkout note" });

      const response = await update({ accepted: true, notes: "Updated note" });
      expect(response.status).toBe(200);
      const data = response.body.data;
      // The member-level declaration is now the current one; its history is returned.
      expect(data.current).toMatchObject({ kind: "MEMBER", formId: null, notes: "Updated note", revisionCount: 1 });
      expect(data.revisions.map((row: any) => [row.kind, row.source, row.notes])).toEqual([["MEMBER", "MEMBER_UPDATE", "Updated note"]]);
      expect(data.declarations).toHaveLength(3);
      const bookingDeclaration = data.declarations.find((row: any) => row.formId === form.id);
      expect(bookingDeclaration).toMatchObject({ kind: "BOOKING", bookingId: booking.id, notes: "Updated note", revisionCount: 2 });
      expect(bookingDeclaration.booking).toMatchObject({ id: booking.id, bookingStatus: "CONFIRMED", paymentReference: booking.paymentReference, className: "Reformer", startTime: "10:00" });
      expect(data.propagation.updatedBookings.map((row: any) => row.formId).sort()).toEqual([olderForm.id, form.id].sort());

      const saved = await prisma.healthSafetyForm.findUnique({ where: { id: form.id } });
      expect(saved).toMatchObject({ notes: "Updated note", accepted: true, declarationVersion: "1.0" });
      expect(saved.submittedAt.getTime()).toBe(saved.acceptedAt.getTime());
      expect(saved.updatedAt.getTime()).toBeGreaterThanOrEqual(saved.submittedAt.getTime());

      const formRevisions = async (formId: string) =>
        prisma.healthSafetyRevision.findMany({ where: { formId }, orderBy: { createdAt: "asc" } });
      const baseline = (await formRevisions(form.id))[0];
      expect(baseline).toMatchObject({ source: "BASELINE", notes: "Checkout note" });

      await update({ accepted: true, notes: "Third note" });
      const revisions = await formRevisions(form.id);
      expect(revisions.map((row: any) => row.notes)).toEqual(["Checkout note", "Updated note", "Third note"]);
      expect(revisions[0]).toEqual(baseline);
      expect((await formRevisions(olderForm.id)).map((row: any) => row.notes)).toEqual(["Old booking note", "Updated note", "Third note"]);
    });

    it("a backfilled declaration gets no extra baseline", async () => {
      const { form } = await bookingWithForm(member);
      await prisma.healthSafetyRevision.create({
        data: { kind: "BOOKING", formId: form.id, userId: member.id, bookingId: form.bookingId, accepted: true, notes: form.notes, source: "BACKFILL", actorType: "SYSTEM", createdAt: form.submittedAt },
      });

      await update({ accepted: true, notes: "After backfill" });
      const sources = (await prisma.healthSafetyRevision.findMany({ where: { formId: form.id }, orderBy: { createdAt: "asc" } })).map((row: any) => row.source);
      expect(sources).toEqual(["BACKFILL", "MEMBER_UPDATE"]);
    });

    it("may name one of their own bookings; another member's booking is 404 and untouched", async () => {
      const { booking: older, form: olderForm } = await bookingWithForm(member, { notes: "Older" });
      const { form: newerForm } = await bookingWithForm(member, { notes: "Newer" });
      const { booking: theirs, form: theirForm } = await bookingWithForm(other, { notes: "Not yours" });

      const targeted = await update({ accepted: true, notes: "Targeted", bookingId: older.id });
      expect(targeted.status).toBe(200);
      // Both are upcoming, so both receive it.
      expect((await prisma.healthSafetyForm.findUnique({ where: { id: olderForm.id } })).notes).toBe("Targeted");
      expect((await prisma.healthSafetyForm.findUnique({ where: { id: newerForm.id } })).notes).toBe("Targeted");

      const denied = await update({ accepted: true, notes: "Hijack", bookingId: theirs.id });
      expect(denied.status).toBe(404);
      expect(denied.body.code).toBe("DECLARATION_NOT_FOUND");
      expect(await prisma.healthSafetyForm.findUnique({ where: { id: theirForm.id } })).toMatchObject({ notes: "Not yours" });
      expect(await prisma.healthSafetyRevision.count({ where: { formId: theirForm.id } })).toBe(0);
    });

    it("never trusts a client-supplied user ID and validates input", async () => {
      for (const body of [
        { accepted: true, userId: other.id },
        { accepted: false },
        {},
        { accepted: true, notes: "x".repeat(2001) },
        { accepted: true, bookingId: "bad id!" },
      ]) {
        const response = await update(body);
        expect(response.status, JSON.stringify(body)).toBe(400);
        expect(response.body).toMatchObject({ success: false, code: "VALIDATION_ERROR" });
      }
      expect(await prisma.healthSafetyRevision.count()).toBe(0);
    });

    it("atomic: if writing the revision fails, the form is not changed either", async () => {
      const { form } = await bookingWithForm(member, { notes: "Before" });
      await prisma.$executeRawUnsafe(`
        CREATE OR REPLACE FUNCTION test_fail_revision() RETURNS trigger AS $$
        BEGIN
          IF NEW."source" = 'MEMBER_UPDATE' THEN RAISE EXCEPTION 'test failure'; END IF;
          RETURN NEW;
        END; $$ LANGUAGE plpgsql;
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER test_fail_revision BEFORE INSERT ON "HealthSafetyRevision"
        FOR EACH ROW EXECUTE FUNCTION test_fail_revision();
      `);

      try {
        const response = await update({ accepted: true, notes: "After" });
        expect(response.status).toBe(500);
        expect(response.body).toMatchObject({ success: false, message: "Something went wrong. Please try again." });
        expect(JSON.stringify(response.body)).not.toMatch(/test failure|prisma|HealthSafetyRevision/i);
      } finally {
        await prisma.$executeRawUnsafe(`DROP TRIGGER test_fail_revision ON "HealthSafetyRevision"`);
        await prisma.$executeRawUnsafe(`DROP FUNCTION test_fail_revision()`);
      }

      expect(await prisma.healthSafetyForm.findUnique({ where: { id: form.id } })).toMatchObject({ notes: "Before" });
      // The baseline written in the same transaction was rolled back too.
      expect(await prisma.healthSafetyRevision.count()).toBe(0);
    });

    it("concurrent updates by one member each create a revision; none is lost", async () => {
      const { form } = await bookingWithForm(member);
      const results = await Promise.all(
        ["A", "B", "C"].map((notes) => update({ accepted: true, notes }))
      );
      expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
      const rows = await prisma.healthSafetyRevision.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
      const of = (kind: string) => rows.filter((row: any) => row.kind === kind).map((row: any) => row.source).sort();
      // Per update: one member-level revision and one for the upcoming booking.
      expect(of("MEMBER")).toEqual(["MEMBER_UPDATE", "MEMBER_UPDATE", "MEMBER_UPDATE"]);
      expect(of("BOOKING")).toEqual(["BASELINE", "MEMBER_UPDATE", "MEMBER_UPDATE", "MEMBER_UPDATE"]);
      // Serialised: the form holds whichever update committed last, and so does the member level.
      const lastMember = rows.filter((row: any) => row.kind === "MEMBER").at(-1);
      expect((await prisma.healthSafetyForm.findUnique({ where: { id: form.id } })).notes).toBe(lastMember.notes);
    });
  });

  describe("existing checkout declaration routes are unchanged", () => {
    it("the PENDING-only account route still refuses a confirmed booking", async () => {
      const { booking, form } = await bookingWithForm(member, { notes: "Checkout note", status: "CONFIRMED" });

      const response = await request(app)
        .patch(`/api/bookings/${booking.id}/health-declaration/account`)
        .set(as(member))
        .send({ accepted: true, notes: "Sneaky change" });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe("This booking can no longer be changed.");
      expect(await prisma.healthSafetyForm.findUnique({ where: { id: form.id } })).toMatchObject({ notes: "Checkout note" });
      expect(await prisma.healthSafetyRevision.count()).toBe(0);
    });
  });

  describe("notifications and activity log", () => {
    it("one notification per update, unique event keys, no health content, push opens the Health & Safety page", async () => {
      await bookingWithForm(member);
      const first = await update({ accepted: true, notes: SECRET_NOTE });
      const second = await update({ accepted: true, notes: SECRET_NOTE + " (2)" });
      await activityLog.flush();

      const notifications = await prisma.adminNotification.findMany({ orderBy: { createdAt: "asc" } });
      expect(notifications).toHaveLength(2);
      expect(notifications.map((row: any) => row.eventKey)).toEqual([
        `health_safety_updated:${first.body.data.revisionId}`,
        `health_safety_updated:${second.body.data.revisionId}`,
      ]);
      expect(notifications[0]).toMatchObject({
        adminId: admin.id,
        type: "HEALTH_SAFETY_UPDATED",
        title: "Health & Safety declaration updated",
        message: "Mina Member updated their Health & Safety declaration.",
        data: expect.objectContaining({ userId: member.id, revisionId: first.body.data.revisionId, url: "/admin/health-safety" }),
      });

      expect(push.sent).toHaveLength(2);
      expect(push.sent[0]).toMatchObject({ type: "HEALTH_SAFETY_UPDATED", url: "/admin/health-safety" });

      // Notes appear nowhere outside the declaration tables.
      const everywhere = JSON.stringify([notifications, push.sent, await prisma.memberActivityLog.findMany()]);
      expect(everywhere).not.toContain("SECRET-HEALTH-NOTE");

      const events = await prisma.memberActivityLog.findMany({ where: { action: "health_safety.update" } });
      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        status: "SUCCESS",
        userId: member.id,
        entityType: "HEALTH_SAFETY_REVISION",
        metadata: expect.objectContaining({ notesProvided: true, declarationKind: "MEMBER", upcomingBookingsUpdated: 1, declarationChanged: true }),
      });
    });

    it("existing notification types keep the generic /admin destination", async () => {
      await notificationService.createForAllAdmins({ eventKey: "paymish:SL-X", type: "PAYMENT", title: "Paid", message: "m" });
      expect(push.sent.at(-1)).toMatchObject({ type: "PAYMENT", url: "/admin" });
    });

    it("a notification failure does not fail or undo the saved update", async () => {
      await bookingWithForm(member);
      const spy = vi.spyOn(notificationService, "createForAllAdmins").mockRejectedValueOnce(new Error("push down"));

      const response = await update({ accepted: true, notes: "Saved anyway" });
      await activityLog.flush();
      spy.mockRestore();

      expect(response.status).toBe(200);
      expect(await prisma.healthSafetyRevision.count({ where: { source: "MEMBER_UPDATE", kind: "MEMBER" } })).toBe(1);
      expect(await prisma.healthSafetyRevision.count({ where: { source: "MEMBER_UPDATE", kind: "BOOKING" } })).toBe(1);
      expect(await prisma.memberActivityLog.findMany({ where: { action: "health_safety.update", stage: "WARNING" } })).toEqual([
        expect.objectContaining({ errorCode: "NOTIFICATION_FAILED" }),
      ]);
    });
  });

  describe("admin GET /api/admin/health-safety", () => {
    it("is admin-only", async () => {
      expect((await request(app).get("/api/admin/health-safety")).status).toBe(401);
      expect((await request(app).get("/api/admin/health-safety").set(as(member))).status).toBe(403);
      expect((await request(app).get("/api/admin/health-safety").set(as(tutor))).status).toBe(403);
      expect((await request(app).get("/api/admin/health-safety/revisions?userId=x").set(as(member))).status).toBe(403);
    });

    it("lists each declaration separately with contact, booking and revision details", async () => {
      const { form: f1, booking: b1 } = await bookingWithForm(member, { notes: "First booking" });
      await bookingWithForm(member, { notes: "Second booking" });
      const { booking: guestBooking } = await bookingWithForm(null, { notes: "Guest note" });
      await update({ accepted: true, notes: "Member-level" }, other); // other has no booking

      await update({ accepted: true, notes: "Edited first", bookingId: b1.id });

      const response = await request(app).get("/api/admin/health-safety").set(as(admin));
      expect(response.status).toBe(200);
      const { declarations, pagination } = response.body.data;
      // Mina: 2 bookings + her member-level declaration; guest; Otto's member-level.
      expect(pagination).toMatchObject({ page: 1, limit: 25, total: 5, totalPages: 1 });

      const mina = declarations.filter((row: any) => row.userId === member.id);
      expect(mina.map((row: any) => row.kind).sort()).toEqual(["BOOKING", "BOOKING", "MEMBER"]);
      // Both of Mina's upcoming bookings received the edit.
      expect(mina.every((row: any) => row.notes === "Edited first")).toBe(true);
      const edited = declarations.find((row: any) => row.formId === f1.id);
      expect(edited).toMatchObject({
        kind: "BOOKING",
        fullName: "Mina Member",
        email: "mina@example.com",
        phone: "08000000002",
        isGuest: false,
        bookingId: b1.id,
        accepted: true,
        notes: "Edited first",
        declarationVersion: "1.0",
        revisionCount: 2,
        booking: expect.objectContaining({ bookingStatus: "CONFIRMED", paymentReference: b1.paymentReference, className: "Reformer" }),
      });
      expect(edited.submittedAt && edited.acceptedAt && edited.updatedAt).toBeTruthy();
      // Newest update first: Mina's (all written at the same instant).
      expect(declarations.slice(0, 3).every((row: any) => row.userId === member.id)).toBe(true);

      const guest = declarations.find((row: any) => row.bookingId === guestBooking.id);
      expect(guest).toMatchObject({ isGuest: true, userId: null, fullName: "Gail Guest", email: "gail@example.com", phone: "08077778888", notes: "Guest note" });

      const memberLevel = declarations.find((row: any) => row.kind === "MEMBER" && row.userId === other.id);
      expect(memberLevel).toMatchObject({ userId: other.id, fullName: "Otto Other", bookingId: null, notes: "Member-level", revisionCount: 1 });

      expect(JSON.stringify(response.body)).not.toMatch(/hashhashhash|password/);
    });

    it("paginates and filters", async () => {
      for (let i = 0; i < 3; i += 1) await bookingWithForm(member);
      await bookingWithForm(null);
      await update({ accepted: true, notes: "Member-level" }, other);

      const page1 = await request(app).get("/api/admin/health-safety?limit=2&page=1").set(as(admin));
      const page3 = await request(app).get("/api/admin/health-safety?limit=2&page=3").set(as(admin));
      expect(page1.body.data.pagination).toMatchObject({ total: 5, totalPages: 3, hasNextPage: true });
      expect(page1.body.data.declarations).toHaveLength(2);
      expect(page3.body.data.declarations).toHaveLength(1);

      const count = async (query: string) =>
        (await request(app).get(`/api/admin/health-safety?${query}`).set(as(admin))).body.data.pagination.total;
      expect(await count(`userId=${member.id}`)).toBe(3);
      expect(await count("kind=MEMBER")).toBe(1);
      expect(await count("kind=BOOKING")).toBe(4);
      expect(await count("search=gail")).toBe(1);
      expect(await count("accepted=false")).toBe(0);

      const bad = await request(app).get("/api/admin/health-safety?limit=500").set(as(admin));
      expect(bad.status).toBe(400);
      expect((await request(app).get("/api/admin/health-safety?notes=x").set(as(admin))).status).toBe(400);
    });

    it("revision history by form or by member", async () => {
      const { form } = await bookingWithForm(member, { notes: "Checkout" });
      await update({ accepted: true, notes: "Edit 1" });
      await update({ accepted: true, notes: "Edit 2" });

      const byForm = await request(app).get(`/api/admin/health-safety/revisions?formId=${form.id}`).set(as(admin));
      expect(byForm.body.data.revisions.map((row: any) => row.notes)).toEqual(["Edit 2", "Edit 1", "Checkout"]);

      const byMember = await request(app).get(`/api/admin/health-safety/revisions?userId=${member.id}`).set(as(admin));
      // The booking's 3 plus the 2 member-level ones.
      expect(byMember.body.data.revisions.map((row: any) => `${row.kind}:${row.notes}`).sort()).toEqual(
        ["BOOKING:Checkout", "BOOKING:Edit 1", "BOOKING:Edit 2", "MEMBER:Edit 1", "MEMBER:Edit 2"]
      );

      const neither = await request(app).get("/api/admin/health-safety/revisions").set(as(admin));
      expect(neither.status).toBe(400);
    });
  });

  describe("admin GET /api/admin/memberships", () => {
    beforeEach(async () => {
      await prisma.membership.create({ data: { name: "Unlimited", slug: "unlimited", type: "GROUP", price: 90000, period: "/month", classLimit: null, duration: "Monthly", features: [] } });
      await prisma.membership.create({ data: { name: "Private 4", slug: "private-4", type: "PRIVATE", price: 80000, period: "/month", classLimit: 4, duration: "Monthly", features: [] } });
      await prisma.membership.create({ data: { name: "Old private", slug: "old-private", type: "PRIVATE", price: 1, period: "/month", classLimit: 2, duration: "Monthly", features: [], isActive: false } });
      await prisma.membership.create({ data: { name: "Old group", slug: "old-group", type: "GROUP", price: 1, period: "/month", classLimit: null, duration: "Monthly", features: [], isActive: false } });
    });

    it("is admin-only", async () => {
      expect((await request(app).get("/api/admin/memberships")).status).toBe(401);
      expect((await request(app).get("/api/admin/memberships").set(as(member))).status).toBe(403);
    });

    it("returns every plan: both types, active and inactive, unlimited flagged", async () => {
      const response = await request(app).get("/api/admin/memberships").set(as(admin));
      expect(response.status).toBe(200);
      const plans = response.body.data;
      expect(plans).toHaveLength(5);
      const byName = Object.fromEntries(plans.map((row: any) => [row.name, row]));
      expect(byName["Unlimited"]).toMatchObject({ type: "GROUP", classLimit: null, isUnlimited: true, isActive: true });
      expect(byName["Monthly"]).toMatchObject({ classLimit: 8, isUnlimited: false, isActive: true });
      expect(byName["Old private"]).toMatchObject({ type: "PRIVATE", isActive: false, isUnlimited: false });
      expect(byName["Old group"]).toMatchObject({ isActive: false, isUnlimited: true });
      for (const row of plans) {
        expect(Object.keys(row)).toEqual(expect.arrayContaining(["id", "name", "type", "price", "classLimit", "duration", "isActive"]));
      }

      const privateInactive = await request(app).get("/api/admin/memberships?type=PRIVATE&isActive=false").set(as(admin));
      expect(privateInactive.body.data.map((row: any) => row.name)).toEqual(["Old private"]);
    });

    it("the public GET /api/memberships is unchanged: active plans only, type filter", async () => {
      const all = await request(app).get("/api/memberships");
      expect(all.status).toBe(200);
      expect(all.body.data.map((row: any) => row.name).sort()).toEqual(["Monthly", "Private 4", "Unlimited"]);
      expect(all.body.data[0].isUnlimited).toBeUndefined();

      const group = await request(app).get("/api/memberships?type=GROUP");
      expect(group.body.data.map((row: any) => row.name).sort()).toEqual(["Monthly", "Unlimited"]);
    });
  });
});
