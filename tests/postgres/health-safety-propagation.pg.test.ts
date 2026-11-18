/* eslint-disable @typescript-eslint/no-explicit-any -- services are imported dynamically after DATABASE_URL is set */
/**
 * 1. The checkout compatibility path PATCH /api/bookings/:id/health-safety
 *    (guest token and signed-in), with the existing checkout rules.
 * 2. Member Health & Safety updates applied to all upcoming bookings,
 *    with immutable revisions, against a REAL PostgreSQL database and the
 *    REAL Express app. Only the mailer and web-push are stubbed.
 *
 * Skipped unless TEST_DATABASE_URL is set; see
 * tests/postgres/membership-concurrency.pg.test.ts for setup. Run the
 * postgres files with --no-file-parallelism.
 */
import crypto from "node:crypto";
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

const SECRET_NOTE = "Asthma, uses inhaler SECRET-HEALTH-NOTE";
const DAY = 86_400_000;

describe.skipIf(!TEST_DATABASE_URL)("PostgreSQL: Health & Safety checkout path and propagation", () => {
  let prisma: any;
  let app: any;
  let activityLog: any;
  let token: (user: any) => string;
  let admin: any;
  let member: any;
  let other: any;
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
  const update = (body: any, user: any = member) =>
    request(app).patch("/api/members/me/health-safety").set(as(user)).send(body);

  /** Lagos calendar date `offset` days from today, at UTC midnight (sessionDate's encoding). */
  const lagosDay = (offset: number) => {
    const lagos = new Date(Date.now() + 60 * 60 * 1000);
    return new Date(Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), lagos.getUTCDate()) + offset * DAY);
  };

  let count = 0;
  async function makeBooking(
    owner: any,
    options: {
      days?: number;
      startTime?: string;
      status?: string;
      paymentStatus?: string;
      sessionStatus?: string;
      form?: string | null; // notes; null = no form
      withSession?: boolean;
      flowToken?: string;
    } = {}
  ) {
    count += 1;
    const schedule = await prisma.schedule.create({
      data: { code: `P${count}`, className: "Reformer", tutorName: "Tess", dayOfWeek: "MONDAY", startTime: options.startTime ?? "10:00", endTime: "11:00" },
    });
    const session =
      options.withSession === false
        ? null
        : await prisma.classSession.create({
            data: { scheduleId: schedule.id, sessionDate: lagosDay(options.days ?? 3), status: options.sessionStatus ?? "OPEN" },
          });
    const booking = await prisma.booking.create({
      data: {
        fullName: owner?.fullName ?? "Gail Guest",
        email: owner?.email ?? "gail@example.com",
        phone: "08077778888",
        userId: owner?.id ?? null,
        membershipId: plan.id,
        sessionId: session?.id ?? null,
        scheduleId: schedule.id,
        classId: "Reformer",
        amount: 0,
        paymentReference: `SL-HSP-${count}`,
        paymentStatus: options.paymentStatus ?? "PAID",
        paymentMethod: "OFFLINE",
        bookingStatus: options.status ?? "CONFIRMED",
        bookingFlowTokenHash: options.flowToken
          ? crypto.createHash("sha256").update(options.flowToken).digest("hex")
          : null,
      },
    });
    const notes = options.form === undefined ? `Checkout note ${count}` : options.form;
    const submittedAt = new Date(Date.now() - (100 - count) * 60_000);
    const form =
      notes === null
        ? null
        : await prisma.healthSafetyForm.create({
            data: {
              bookingId: booking.id,
              userId: owner?.id ?? null,
              accepted: true,
              declarationVersion: "1.0",
              notes,
              acceptedAt: submittedAt,
              submittedAt,
              createdAt: submittedAt,
              pregnancy: "no",
              signature: "Signed",
            },
          });
    return { booking, form, session };
  }

  const formOf = (bookingId: string) => prisma.healthSafetyForm.findUnique({ where: { bookingId } });
  const revisionsOf = (formId: string) =>
    prisma.healthSafetyRevision.findMany({ where: { formId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

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
    await activityLog.flush();
    await truncateAll();
    push.sent.length = 0;
    const user = (email: string, role: string, fullName: string) =>
      prisma.user.create({ data: { email, role, fullName, phone: "0800", password: "$2a$10$hashhashhash" } });
    admin = await user("admin@example.com", "ADMIN", "Ada Admin");
    member = await user("mina@example.com", "MEMBER", "Mina Member");
    other = await user("otto@example.com", "MEMBER", "Otto Other");
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

  // ===================================================================
  // 1. Checkout: PATCH /api/bookings/:bookingId/health-safety
  // ===================================================================

  describe("checkout PATCH /api/bookings/:bookingId/health-safety", () => {
    const save = (bookingId: string, body: any, headers: Record<string, string> = {}) =>
      request(app).patch(`/api/bookings/${bookingId}/health-safety`).set(headers).send(body);

    // The payload the checkout component sends (accepted plus its form fields).
    const checkoutPayload = {
      fullName: "Mina Member",
      email: "mina@example.com",
      phone: "0800",
      consent: ["The information I have provided is accurate and complete."],
      signature: "Mina",
      accepted: true,
      age: 31,
      screeningAnswers: { screening_0: "no" },
      notes: "Mild knee pain",
    };

    it("signed-in checkout saves the declaration on the member's PENDING paid booking", async () => {
      const { booking } = await makeBooking(member, { status: "PENDING", form: null });

      const response = await save(booking.id, checkoutPayload, as(member));

      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(response.body).toMatchObject({ success: true, data: { healthSafetyForm: { bookingId: booking.id, userId: member.id, accepted: true, notes: "Mild knee pain", declarationVersion: "1.0" } } });
      expect(await prisma.healthSafetyForm.count({ where: { bookingId: booking.id } })).toBe(1);
    });

    it("guest checkout saves with its booking token; the form is linked to that booking", async () => {
      const { booking } = await makeBooking(null, { status: "PENDING", form: null, flowToken: "guest-token-1" });

      const response = await save(booking.id, { bookingFlowToken: "guest-token-1", accepted: true, notes: "Guest note" });

      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(response.body.message).toBe("Health Declaration accepted successfully.");
      expect(await formOf(booking.id)).toMatchObject({ bookingId: booking.id, userId: null, notes: "Guest note" });
    });

    it("saving twice keeps one declaration per booking (upsert, no duplicate)", async () => {
      const { booking } = await makeBooking(member, { status: "PENDING", form: null });
      await save(booking.id, { accepted: true, notes: "First" }, as(member));
      const second = await save(booking.id, { accepted: true, notes: "Second" }, as(member));

      expect(second.status).toBe(200);
      const forms = await prisma.healthSafetyForm.findMany({ where: { bookingId: booking.id } });
      expect(forms).toHaveLength(1);
      expect(forms[0].notes).toBe("Second");
    });

    it("rejects: no credentials (401), invalid access token (401), wrong guest token, unknown booking", async () => {
      const { booking } = await makeBooking(null, { status: "PENDING", form: null, flowToken: "right-token" });

      expect((await save(booking.id, { accepted: true })).status).toBe(401);
      expect((await save(booking.id, { accepted: true }, { Authorization: "Bearer garbage" })).status).toBe(401);

      const wrongToken = await save(booking.id, { bookingFlowToken: "wrong-token", accepted: true });
      expect(wrongToken.status).toBe(400);
      expect(wrongToken.body.message).toBe("Booking session is invalid or has expired.");

      const unknownSignedIn = await save("does-not-exist", { accepted: true }, as(member));
      expect(unknownSignedIn.status).toBe(400);
      expect(unknownSignedIn.body.message).toBe("This booking does not belong to your account.");

      const unknownGuest = await save("does-not-exist", { bookingFlowToken: "right-token", accepted: true });
      expect(unknownGuest.status).toBe(400);

      expect(await prisma.healthSafetyForm.count()).toBe(0);
    });

    it("another member's booking is refused and untouched", async () => {
      const { booking } = await makeBooking(other, { status: "PENDING", form: null });

      const response = await save(booking.id, { accepted: true, notes: "Hijack" }, as(member));

      expect(response.status).toBe(400);
      expect(response.body.message).toBe("This booking does not belong to your account.");
      expect(await formOf(booking.id)).toBeNull();
    });

    it("keeps the checkout rules: unpaid refused, accepted must be true, confirmed bookings cannot be changed", async () => {
      const unpaid = await makeBooking(member, { status: "PENDING", paymentStatus: "PENDING", form: null });
      const unpaidResponse = await save(unpaid.booking.id, { accepted: true }, as(member));
      expect(unpaidResponse.status).toBe(400);
      expect(unpaidResponse.body.message).toBe("Payment has not been completed for this booking.");

      const pending = await makeBooking(member, { status: "PENDING", form: null });
      const notAccepted = await save(pending.booking.id, { accepted: false }, as(member));
      expect(notAccepted.status).toBe(400);
      expect(notAccepted.body.message).toBe("You must accept the Health Declaration to continue.");

      const confirmed = await makeBooking(member, { status: "CONFIRMED", form: "Original" });
      const confirmedResponse = await save(confirmed.booking.id, { accepted: true, notes: "Sneaky" }, as(member));
      expect(confirmedResponse.status).toBe(400);
      expect(confirmedResponse.body.message).toBe("This booking can no longer be changed.");
      expect((await formOf(confirmed.booking.id)).notes).toBe("Original");

      const guestConfirmed = await makeBooking(null, { status: "CONFIRMED", form: "Guest original", flowToken: "g2" });
      const guestResponse = await save(guestConfirmed.booking.id, { bookingFlowToken: "g2", accepted: true, notes: "Sneaky" });
      expect(guestResponse.status).toBe(400);
      expect((await formOf(guestConfirmed.booking.id)).notes).toBe("Guest original");
    });

    it("the original routes still behave exactly the same", async () => {
      const { booking } = await makeBooking(member, { status: "PENDING", form: null });
      const viaAccount = await request(app)
        .patch(`/api/bookings/${booking.id}/health-declaration/account`)
        .set(as(member))
        .send({ accepted: true, notes: "Account route" });
      expect(viaAccount.status).toBe(200);

      const guest = await makeBooking(null, { status: "PENDING", form: null, flowToken: "t3" });
      const viaGuest = await request(app)
        .patch(`/api/bookings/${guest.booking.id}/health-declaration`)
        .send({ bookingFlowToken: "t3", accepted: true });
      expect(viaGuest.status).toBe(200);
      expect((await request(app).patch(`/api/bookings/${guest.booking.id}/health-declaration`).send({ accepted: true })).status).toBe(401);
    });
  });

  // ===================================================================
  // 2. Member update applied to upcoming bookings
  // ===================================================================

  describe("member update propagates to upcoming bookings", () => {
    it("past booking unchanged; upcoming bookings updated; every change has a revision; old revisions intact", async () => {
      const past = await makeBooking(member, { days: -8, form: "Nov 10 note" });
      const soon = await makeBooking(member, { days: 2, form: "Nov 20 note" });
      const later = await makeBooking(member, { days: 17, form: "Dec 5 note" });
      // A revision from an earlier change, which must never be rewritten.
      const earlier = await prisma.healthSafetyRevision.create({
        data: { kind: "BOOKING", formId: soon.form.id, userId: member.id, bookingId: soon.booking.id, accepted: true, notes: "Nov 20 note", source: "BACKFILL", actorType: "SYSTEM", createdAt: soon.form.submittedAt },
      });
      const pastBefore = await formOf(past.booking.id);

      const response = await update({ accepted: true, notes: "Nov 18 update" });

      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(response.body.data.propagation.changed).toBe(true);
      expect(response.body.data.propagation.updatedBookings.map((row: any) => row.bookingId).sort()).toEqual(
        [soon.booking.id, later.booking.id].sort()
      );
      expect(response.body.data.current).toMatchObject({ kind: "MEMBER", notes: "Nov 18 update" });

      // November 10: exactly as it was, no revision.
      expect(await formOf(past.booking.id)).toEqual(pastBefore);
      expect(await revisionsOf(past.form.id)).toHaveLength(0);

      // November 20 and December 5: updated; other checkout answers kept.
      for (const item of [soon, later]) {
        const saved = await formOf(item.booking.id);
        expect(saved).toMatchObject({ notes: "Nov 18 update", accepted: true, declarationVersion: "1.0", userId: member.id, pregnancy: "no", signature: "Signed", bookingId: item.booking.id });
      }
      expect((await revisionsOf(soon.form.id)).map((row: any) => [row.source, row.notes])).toEqual([
        ["BACKFILL", "Nov 20 note"],
        ["MEMBER_UPDATE", "Nov 18 update"],
      ]);
      expect((await revisionsOf(later.form.id)).map((row: any) => [row.source, row.notes])).toEqual([
        ["BASELINE", "Dec 5 note"],
        ["MEMBER_UPDATE", "Nov 18 update"],
      ]);
      const memberUpdate = (await revisionsOf(later.form.id))[1];
      expect(memberUpdate).toMatchObject({ kind: "BOOKING", userId: member.id, bookingId: later.booking.id, actorType: "MEMBER", actorUserId: member.id });

      // The earlier revision is byte-for-byte unchanged.
      expect(await prisma.healthSafetyRevision.findUnique({ where: { id: earlier.id } })).toEqual(earlier);
      // Member-level declaration recorded too.
      expect(await prisma.healthSafetyRevision.count({ where: { userId: member.id, kind: "MEMBER" } })).toBe(1);
    });

    it("cancelled, completed, cancelled-session, unpaid, session-less and started-today bookings are left alone", async () => {
      const cases = [
        await makeBooking(member, { days: 4, status: "CANCELLED" }),
        await makeBooking(member, { days: 4, sessionStatus: "COMPLETED" }),
        await makeBooking(member, { days: 4, sessionStatus: "CANCELLED" }),
        await makeBooking(member, { days: 4, status: "PENDING", paymentStatus: "PENDING" }),
        await makeBooking(member, { withSession: false }),
        await makeBooking(member, { days: -1 }),
        // Today in Lagos at 00:00: already started.
        await makeBooking(member, { days: 0, startTime: "00:00" }),
      ];
      const before = await Promise.all(cases.map((item) => formOf(item.booking.id)));

      const response = await update({ accepted: true, notes: "New" });

      expect(response.status).toBe(200);
      expect(response.body.data.propagation.updatedBookings).toEqual([]);
      expect(await Promise.all(cases.map((item) => formOf(item.booking.id)))).toEqual(before);
      expect(await prisma.healthSafetyRevision.count({ where: { kind: "BOOKING" } })).toBe(0);
    });

    it("FULL sessions and paid PENDING bookings with a declaration are upcoming; a confirmed booking without one gets one", async () => {
      const full = await makeBooking(member, { days: 3, sessionStatus: "FULL" });
      const paidPending = await makeBooking(member, { days: 3, status: "PENDING" });
      const noForm = await makeBooking(member, { days: 6, form: null });
      const pendingNoForm = await makeBooking(member, { days: 6, status: "PENDING", form: null });

      const response = await update({ accepted: true, notes: "Fresh" });

      expect(response.status).toBe(200);
      expect((await formOf(full.booking.id)).notes).toBe("Fresh");
      expect((await formOf(paidPending.booking.id)).notes).toBe("Fresh");

      const created = await formOf(noForm.booking.id);
      expect(created).toMatchObject({ bookingId: noForm.booking.id, userId: member.id, accepted: true, notes: "Fresh", declarationVersion: "1.0" });
      expect((await revisionsOf(created.id)).map((row: any) => row.source)).toEqual(["MEMBER_UPDATE"]);
      const createdEntry = response.body.data.propagation.updatedBookings.find((row: any) => row.bookingId === noForm.booking.id);
      expect(createdEntry).toMatchObject({ formId: created.id, formCreated: true });

      // Still in checkout without a declaration: checkout collects it.
      expect(await formOf(pendingNoForm.booking.id)).toBeNull();
      // No booking was invented.
      expect(await prisma.booking.count()).toBe(4);
    });

    it("another member's and guest bookings are never touched", async () => {
      const mine = await makeBooking(member, { days: 3 });
      const theirs = await makeBooking(other, { days: 3, form: "Otto note" });
      const guest = await makeBooking(null, { days: 3, form: "Guest note" });
      // A guest booking made with the member's email but never attached.
      await prisma.booking.update({ where: { id: guest.booking.id }, data: { email: member.email } });

      await update({ accepted: true, notes: "Mina's update" });

      expect((await formOf(mine.booking.id)).notes).toBe("Mina's update");
      expect((await formOf(theirs.booking.id)).notes).toBe("Otto note");
      expect((await formOf(guest.booking.id)).notes).toBe("Guest note");
      expect(await revisionsOf(theirs.form.id)).toHaveLength(0);
      expect(await revisionsOf(guest.form.id)).toHaveLength(0);

      // Naming another member's booking is not found and changes nothing.
      const denied = await update({ accepted: true, notes: "Hijack", bookingId: theirs.booking.id });
      expect(denied.status).toBe(404);
      expect((await formOf(theirs.booking.id)).notes).toBe("Otto note");
    });

    it("naming a past booking (the dashboard sends the current one) succeeds and leaves that booking as it was", async () => {
      const past = await makeBooking(member, { days: -5, form: "Past note" });
      const upcoming = await makeBooking(member, { days: 5 });

      const response = await update({ accepted: true, notes: "Now", bookingId: past.booking.id });

      expect(response.status).toBe(200);
      expect((await formOf(past.booking.id)).notes).toBe("Past note");
      expect((await formOf(upcoming.booking.id)).notes).toBe("Now");
    });

    it("a member with no bookings still gets a member-level declaration", async () => {
      const response = await update({ accepted: true, notes: "No bookings yet" });
      expect(response.status).toBe(200);
      expect(response.body.data.current).toMatchObject({ kind: "MEMBER", notes: "No bookings yet" });
      expect(response.body.data.propagation).toEqual({ changed: true, updatedBookings: [] });
      expect(await prisma.healthSafetyForm.count()).toBe(0);
    });

    it("atomic: if a later booking's revision fails, nothing is saved (member level and earlier bookings rolled back)", async () => {
      const first = await makeBooking(member, { days: 2, form: "First" });
      const second = await makeBooking(member, { days: 9, form: "Second" });
      await prisma.$executeRawUnsafe(`
        CREATE OR REPLACE FUNCTION test_fail_second() RETURNS trigger AS $$
        BEGIN
          IF NEW."source" = 'MEMBER_UPDATE' AND NEW."bookingId" = '${second.booking.id}' THEN RAISE EXCEPTION 'test failure'; END IF;
          RETURN NEW;
        END; $$ LANGUAGE plpgsql;
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER test_fail_second BEFORE INSERT ON "HealthSafetyRevision"
        FOR EACH ROW EXECUTE FUNCTION test_fail_second();
      `);

      try {
        const response = await update({ accepted: true, notes: "Should not stick" });
        expect(response.status).toBe(500);
        expect(JSON.stringify(response.body)).not.toMatch(/test failure|Should not stick/);
      } finally {
        await prisma.$executeRawUnsafe(`DROP TRIGGER test_fail_second ON "HealthSafetyRevision"`);
        await prisma.$executeRawUnsafe(`DROP FUNCTION test_fail_second()`);
      }

      expect((await formOf(first.booking.id)).notes).toBe("First");
      expect((await formOf(second.booking.id)).notes).toBe("Second");
      expect(await prisma.healthSafetyRevision.count()).toBe(0);
      expect(await prisma.adminNotification.count()).toBe(0);
    });

    it("a duplicate submission writes no new revisions and sends no second notification", async () => {
      const upcoming = await makeBooking(member, { days: 3 });

      const first = await update({ accepted: true, notes: SECRET_NOTE });
      const revisionsAfterFirst = await prisma.healthSafetyRevision.findMany({ orderBy: { id: "asc" } });
      const second = await update({ accepted: true, notes: `  ${SECRET_NOTE}  ` });

      expect(second.status).toBe(200);
      expect(second.body.message).toBe("Your Health & Safety declaration is already up to date.");
      expect(second.body.data.propagation).toEqual({ changed: false, updatedBookings: [] });
      expect(second.body.data.revisionId).toBe(first.body.data.revisionId);
      expect(await prisma.healthSafetyRevision.findMany({ orderBy: { id: "asc" } })).toEqual(revisionsAfterFirst);
      expect(await prisma.adminNotification.count()).toBe(1);
      expect(push.sent).toHaveLength(1);
      expect((await formOf(upcoming.booking.id)).notes).toBe(SECRET_NOTE);
    });

    it("concurrent identical submissions are serialised: one set of revisions", async () => {
      await makeBooking(member, { days: 3 });
      await makeBooking(member, { days: 4 });

      const results = await Promise.all([1, 2, 3].map(() => update({ accepted: true, notes: "Same" })));

      expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
      expect(results.filter((r) => r.body.data.propagation.changed)).toHaveLength(1);
      expect(await prisma.healthSafetyRevision.count({ where: { kind: "MEMBER" } })).toBe(1);
      expect(await prisma.healthSafetyRevision.count({ where: { kind: "BOOKING", source: "MEMBER_UPDATE" } })).toBe(2);
      expect(await prisma.healthSafetyRevision.count({ where: { kind: "BOOKING", source: "BASELINE" } })).toBe(2);
      expect(await prisma.adminNotification.count()).toBe(1);
    });

    it("one admin notification per update, no health notes anywhere outside the declaration tables", async () => {
      await makeBooking(member, { days: 3 });
      await makeBooking(member, { days: 4, form: null });

      const response = await update({ accepted: true, notes: SECRET_NOTE });
      await activityLog.flush();

      const notifications = await prisma.adminNotification.findMany();
      expect(notifications).toHaveLength(1);
      expect(notifications[0]).toMatchObject({
        type: "HEALTH_SAFETY_UPDATED",
        eventKey: `health_safety_updated:${response.body.data.revisionId}`,
        data: expect.objectContaining({ url: "/admin/health-safety", declarationKind: "MEMBER" }),
      });
      expect(push.sent).toEqual([expect.objectContaining({ url: "/admin/health-safety" })]);

      const events = await prisma.memberActivityLog.findMany({ where: { action: "health_safety.update" } });
      expect(events).toEqual([
        expect.objectContaining({
          status: "SUCCESS",
          metadata: expect.objectContaining({ upcomingBookingsUpdated: 2, declarationFormsCreated: 1, declarationChanged: true, notesProvided: true }),
        }),
      ]);
      const everywhere = JSON.stringify([notifications, push.sent, await prisma.memberActivityLog.findMany()]);
      expect(everywhere).not.toContain("SECRET-HEALTH-NOTE");
    });
  });
});
