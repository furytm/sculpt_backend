/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed fake rows and HTTP bodies */
/**
 * Admin session bookings and credit removal, over HTTP through the real
 * app (auth, routes, controllers, services, audit). Prisma is the
 * in-memory fake; real-database locking is covered in
 * tests/postgres/admin-session-bookings.pg.test.ts.
 *
 * 1. Add Offline Attendee (existing endpoint, improved in place).
 * 2. Add an existing registered member: USE_CREDIT / PAID_OFFLINE.
 * 3. Remove unused credits from one membership.
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

const calendar = vi.hoisted(() => ({ createBookingEvent: vi.fn(async () => ({ eventId: "evt_1", eventUrl: "https://cal.test/evt_1" })) }));
vi.mock("../../src/google-calendar/google-calendar.service.js", () => ({ googleCalendarService: calendar }));

let app: any;
let activityLog: any;
let tokenFor: (user: any) => string;

const DAY = 86_400_000;
const ADMIN = { id: "admin_1", email: "admin@example.com", role: "ADMIN" };
const MEMBER = { id: "member_1", email: "mina@example.com", role: "MEMBER" };
const OTHER = { id: "member_2", email: "otto@example.com", role: "MEMBER" };
const TUTOR = { id: "tutor_1", email: "tess@example.com", role: "TUTOR" };

const auth = (user: any) => ({ Authorization: `Bearer ${tokenFor(user)}` });
const utcDay = (offsetDays: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + offsetDays * DAY);
};

let groupPlan: any;
let privatePlan: any;
let unlimitedPlan: any;

function addSession(options: { days?: number; startTime?: string; endTime?: string; capacity?: number; status?: string } = {}) {
  const schedule = fake.insert("schedule", {
    className: "Reformer",
    tutorName: "Tess",
    code: `S${fake.tables.schedule.length + 1}`,
    dayOfWeek: "MONDAY",
    startTime: options.startTime ?? "10:00",
    endTime: options.endTime ?? "11:00",
    capacity: options.capacity ?? 5,
    isActive: true,
  });
  return fake.insert("classSession", {
    scheduleId: schedule.id,
    sessionDate: utcDay(options.days ?? 3),
    status: options.status ?? "OPEN",
  });
}

function addConfirmed(session: any, plan: any, extra: any = {}) {
  return fake.insert("booking", {
    fullName: "Someone",
    email: `someone${fake.tables.booking.length}@example.com`,
    phone: `0801${String(fake.tables.booking.length).padStart(7, "0")}`,
    sessionId: session.id,
    scheduleId: session.scheduleId,
    membershipId: plan.id,
    amount: 0,
    paymentReference: `SL-EXISTING-${fake.tables.booking.length}`,
    paymentStatus: "PAID",
    paymentMethod: "OFFLINE",
    bookingStatus: "CONFIRMED",
    ...extra,
  });
}

function addMembership(plan: any, overrides: any = {}) {
  return fake.insert("memberMembership", {
    userId: MEMBER.id,
    membershipId: plan.id,
    status: "ACTIVE",
    startDate: utcDay(-5),
    expiryDate: utcDay(25),
    creditsTotal: plan.classLimit,
    creditsUsed: 0,
    ...overrides,
  });
}

const snapshot = (table: string, id: string) => ({ ...fake.get(table as any, id) });
const events = async (action: string) => {
  await activityLog.flush();
  return fake.tables.memberActivityLog.filter((row: any) => row.action === action);
};

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  app = (await import("../../src/app.js")).default;
  activityLog = (await import("../../src/activity-log/activity-log.service.js")).activityLog;
  const { generateAccessToken } = await import("../../src/utils/jwt.js");
  tokenFor = (user) => generateAccessToken({ userId: user.id, email: user.email, role: user.role } as any);
}, 60_000);

beforeEach(async () => {
  await activityLog?.flush();
  fake.reset();
  calendar.createBookingEvent.mockClear();
  for (const user of [ADMIN, MEMBER, OTHER, TUTOR]) {
    fake.insert("user", { ...user, fullName: user.id === MEMBER.id ? "Mina Member" : user.id, phone: "08000000000", password: "x" });
  }
  groupPlan = fake.insert("membership", { name: "Group 8", slug: "group-8", type: "GROUP", price: 15000, period: "/month", classLimit: 8, duration: "Monthly", isActive: true, features: [] });
  privatePlan = fake.insert("membership", { name: "Private 4", slug: "private-4", type: "PRIVATE", price: 40000, period: "/month", classLimit: 4, duration: "Monthly", isActive: true, features: [] });
  unlimitedPlan = fake.insert("membership", { name: "Unlimited", slug: "unlimited", type: "GROUP", price: 90000, period: "/month", classLimit: null, duration: "Monthly", isActive: true, features: [] });
});

// =====================================================================
// 1. Offline attendee
// =====================================================================

describe("POST /api/admin/sessions/:sessionId/offline-attendees", () => {
  const add = (sessionId: string, body: any, user: any = ADMIN) =>
    request(app).post(`/api/admin/sessions/${sessionId}/offline-attendees`).set(auth(user)).send(body);
  const walkIn = (extra: any = {}) => ({ fullName: "Wally Walkin", email: "wally@example.com", phone: "0803 111 2222", ratePlanId: groupPlan.id, ...extra });

  it("admin only", async () => {
    const session = addSession();
    expect((await request(app).post(`/api/admin/sessions/${session.id}/offline-attendees`).send(walkIn())).status).toBe(401);
    expect((await add(session.id, walkIn(), MEMBER)).status).toBe(403);
  });

  it("books a seat only: no User, no MemberMembership, no credits; 2/5 becomes 3/5", async () => {
    const session = addSession();
    addConfirmed(session, groupPlan);
    addConfirmed(session, groupPlan);
    const funded = addMembership(groupPlan, { creditsUsed: 2 });
    const before = { users: fake.tables.user.length, memberships: fake.tables.memberMembership.length, funded: snapshot("memberMembership", funded.id) };

    const response = await add(session.id, walkIn({ amount: 12000 }));

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body.data).toMatchObject({
      attendeeType: "OFFLINE_ATTENDEE",
      bookingType: "GROUP",
      userId: null,
      memberMembershipId: null,
      fullName: "Wally Walkin",
      email: "wally@example.com",
      amount: 12000,
      paymentMethod: "OFFLINE",
      paymentStatus: "PAID",
      bookingStatus: "CONFIRMED",
      sessionId: session.id,
    });
    expect(response.body.data.paymentReference).toMatch(/^OFFLINE-/);
    expect(fake.tables.user).toHaveLength(before.users);
    expect(fake.tables.memberMembership).toHaveLength(before.memberships);
    expect(snapshot("memberMembership", funded.id)).toEqual(before.funded);
    expect(fake.tables.membershipPurchase).toHaveLength(0);

    const listed = (await request(app).get("/api/admin/sessions").set(auth(ADMIN))).body.data;
    const row = (Array.isArray(listed) ? listed : listed.sessions).find((item: any) => item.id === session.id);
    expect(row).toMatchObject({ capacity: 5, bookedCount: 3, availableSlots: 2 });
    expect(row.bookings.map((item: any) => item.fullName)).toContain("Wally Walkin");

    const [event] = await events("admin.session.add_offline_attendee");
    expect(event).toMatchObject({ actorUserId: ADMIN.id, actorType: "ADMIN", entityType: "BOOKING", entityId: response.body.data.id });
    expect(event.metadata).toMatchObject({ classSessionId: session.id, bookingType: "GROUP", paymentMethod: "OFFLINE", amount: 12000 });
  });

  it("keeps the exact plan/package selected (record-keeping only) and the amount separately", async () => {
    // Two GROUP plans: the booking must keep the one chosen, not the first of its type.
    const fiveClass = fake.insert("membership", { name: "Group 5-class", slug: "group-5", type: "GROUP", price: 30000, period: "/month", classLimit: 5, duration: "Monthly", isActive: true, features: [] });
    const session = addSession();
    const counts = { users: fake.tables.user.length, memberships: fake.tables.memberMembership.length, purchases: fake.tables.membershipPurchase.length, activations: fake.tables.membershipActivation.length };

    const response = await add(session.id, walkIn({ ratePlanId: fiveClass.id, amount: 27500 }));

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const created = response.body.data;
    expect(created).toMatchObject({
      membershipId: fiveClass.id,
      amount: 27500,
      bookingType: "GROUP",
      ratePlan: { id: fiveClass.id, name: "Group 5-class", type: "GROUP", price: 30000 },
      userId: null,
      memberMembershipId: null,
    });

    // Stored on the booking row exactly as chosen.
    expect(fake.get("booking", created.id)).toMatchObject({ membershipId: fiveClass.id, amount: 27500 });

    // Retrievable from the admin session attendee records...
    const listed = (await request(app).get("/api/admin/sessions").set(auth(ADMIN))).body.data;
    const row = (Array.isArray(listed) ? listed : listed.sessions).find((item: any) => item.id === session.id);
    expect(row.bookings.find((item: any) => item.id === created.id)).toMatchObject({
      membershipId: fiveClass.id,
      amount: 27500,
      paymentMethod: "OFFLINE",
      membership: { id: fiveClass.id, name: "Group 5-class", type: "GROUP" },
    });
    const detail = (await request(app).get(`/api/admin/sessions/${session.id}`).set(auth(ADMIN))).body.data;
    // (The fake returns whole related rows; the exact selected shape is checked in PostgreSQL.)
    expect(detail.bookings[0].membership).toMatchObject({ id: fiveClass.id, name: "Group 5-class", type: "GROUP" });
    expect(detail).toMatchObject({ groupBookedCount: 1, privateBookedCount: 0 });

    // ...and from the admin booking views (full plan).
    const all = (await request(app).get("/api/admin/bookings").set(auth(ADMIN))).body.data;
    const fromList = (Array.isArray(all) ? all : all.bookings).find((item: any) => item.id === created.id);
    expect(fromList.membership).toMatchObject({ id: fiveClass.id, name: "Group 5-class", classLimit: 5 });
    const one = (await request(app).get(`/api/admin/bookings/${created.id}`).set(auth(ADMIN))).body.data;
    expect((one.booking ?? one).membership).toMatchObject({ id: fiveClass.id, name: "Group 5-class" });

    // Record-keeping only: no account, membership, purchase, activation or credits.
    expect(fake.tables.user).toHaveLength(counts.users);
    expect(fake.tables.memberMembership).toHaveLength(counts.memberships);
    expect(fake.tables.membershipPurchase).toHaveLength(counts.purchases);
    expect(fake.tables.membershipActivation).toHaveLength(counts.activations);
  });

  it("the selected plan sets GROUP/PRIVATE: a private plan books the session privately", async () => {
    const session = addSession();
    const response = await add(session.id, walkIn({ ratePlanId: privatePlan.id, amount: 40000 }));
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ membershipId: privatePlan.id, bookingType: "PRIVATE", ratePlan: { type: "PRIVATE" } });

    const detail = (await request(app).get(`/api/admin/sessions/${session.id}`).set(auth(ADMIN))).body.data;
    expect(detail).toMatchObject({ privateBookedCount: 1, availableSlots: 0 });
    // Now private: a group attendee is refused.
    expect((await add(session.id, walkIn({ email: "g@example.com", phone: "08039990000" }))).body.code).toBe("SESSION_PRIVATE");
  });

  it("the plan is never substituted: unknown, inactive or mismatched plans are refused", async () => {
    const session = addSession();
    const retired = fake.insert("membership", { name: "Old Group", slug: "old-group", type: "GROUP", price: 1, period: "/month", classLimit: 4, duration: "Monthly", isActive: false, features: [] });
    for (const body of [
      walkIn({ ratePlanId: "no-such-plan" }),
      walkIn({ ratePlanId: retired.id }),
      walkIn({ ratePlanId: groupPlan.id, bookingType: "PRIVATE" }),
    ]) {
      const response = await add(session.id, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    expect(fake.tables.booking).toHaveLength(0);
  });

  it("the old request shape (membershipId) still works; the amount defaults to the rate's price", async () => {
    const session = addSession();
    const response = await add(session.id, { fullName: "Old Shape", email: "old@example.com", phone: "08031112223", membershipId: groupPlan.id });
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ amount: 15000, membershipId: groupPlan.id });
  });

  it("rejects duplicates by email (any case) or phone (any formatting)", async () => {
    const session = addSession();
    expect((await add(session.id, walkIn())).status).toBe(201);

    const sameEmail = await add(session.id, walkIn({ email: "WALLY@example.com", phone: "0809 999 0000" }));
    expect(sameEmail.status).toBe(409);
    expect(sameEmail.body).toMatchObject({ code: "DUPLICATE_ATTENDEE", message: "This attendee is already booked for this session." });

    const samePhone = await add(session.id, walkIn({ email: "new@example.com", phone: "08031112222" }));
    expect(samePhone.status).toBe(409);

    // A different session is fine.
    expect((await add(addSession({ days: 4 }).id, walkIn())).status).toBe(201);
    expect(fake.tables.booking.filter((row: any) => row.sessionId === session.id)).toHaveLength(1);
  });

  it("refuses a registered member's email: they are added as members", async () => {
    const session = addSession();
    const response = await add(session.id, walkIn({ email: "MINA@example.com" }));
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("REGISTERED_MEMBER");
    expect(fake.tables.booking).toHaveLength(0);
  });

  it("full group sessions and private-session rules", async () => {
    const full = addSession({ capacity: 2 });
    addConfirmed(full, groupPlan);
    addConfirmed(full, groupPlan);
    const fullResponse = await add(full.id, walkIn());
    expect(fullResponse.status).toBe(409);
    expect(fullResponse.body).toMatchObject({ code: "SESSION_FULL", message: "This group session is full." });

    const privateBooked = addSession({ days: 4 });
    addConfirmed(privateBooked, privatePlan);
    expect((await add(privateBooked.id, walkIn())).body.code).toBe("SESSION_PRIVATE");

    const occupied = addSession({ days: 5 });
    addConfirmed(occupied, groupPlan);
    expect((await add(occupied.id, walkIn({ ratePlanId: privatePlan.id }))).body.code).toBe("SESSION_OCCUPIED");

    // Cancelled bookings don't hold seats.
    const freed = addSession({ days: 6, capacity: 1 });
    addConfirmed(freed, groupPlan, { bookingStatus: "CANCELLED" });
    expect((await add(freed.id, walkIn())).status).toBe(201);
  });

  it("payment is always PAID: PENDING (which would not hold a seat) is refused", async () => {
    const session = addSession();
    for (const paymentStatus of ["PENDING", "FAILED", "paid"]) {
      const response = await add(session.id, walkIn({ paymentStatus }));
      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
    }
    expect((await add(session.id, walkIn({ paymentStatus: "PAID" }))).body.data.bookingStatus).toBe("CONFIRMED");
    expect(fake.tables.booking.every((row: any) => row.paymentStatus === "PAID" && row.bookingStatus === "CONFIRMED")).toBe(true);
  });

  it("session time: allowed until the class ends (walk-ins), refused once it has ended", async () => {
    // Today, 00:00–23:59 Lagos: started but not ended.
    const running = addSession({ days: 0, startTime: "00:00", endTime: "23:59" });
    expect((await add(running.id, walkIn())).status).toBe(201);

    const ended = addSession({ days: -1 });
    const endedResponse = await add(ended.id, walkIn());
    expect(endedResponse.status).toBe(409);
    expect(endedResponse.body.code).toBe("SESSION_ENDED");

    const cancelled = addSession({ status: "CANCELLED" });
    expect((await add(cancelled.id, walkIn())).body.code).toBe("SESSION_NOT_OPEN");
  });

  it("validates input", async () => {
    const session = addSession();
    for (const body of [
      walkIn({ fullName: "" }),
      walkIn({ ratePlanId: undefined }),
      walkIn({ email: "", phone: "" }),
      walkIn({ email: "not-an-email" }),
      walkIn({ phone: "12" }),
      walkIn({ amount: -1 }),
      walkIn({ amount: 1.5 }),
      walkIn({ bookingType: "PRIVATE" }), // rate is GROUP
      walkIn({ ratePlanId: "missing" }),
    ]) {
      const response = await add(session.id, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    expect((await add("missing-session", walkIn())).status).toBe(404);
    expect(fake.tables.booking).toHaveLength(0);
  });

  it("admin cancellation of an attendee frees the seat and restores no credit", async () => {
    const session = addSession({ capacity: 1 });
    const funded = addMembership(groupPlan, { creditsUsed: 3 });
    const attendee = (await add(session.id, walkIn())).body.data;

    const cancelled = await request(app).post(`/api/admin/bookings/${attendee.id}/cancel`).set(auth(ADMIN));
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(fake.get("memberMembership", funded.id).creditsUsed).toBe(3);
    expect((await add(session.id, walkIn({ email: "next@example.com", phone: "08035550000" }))).status).toBe(201);
  });
});

// =====================================================================
// 2. Existing member
// =====================================================================

describe("POST /api/admin/sessions/:sessionId/members", () => {
  const addMember = (sessionId: string, body: any, user: any = ADMIN) =>
    request(app).post(`/api/admin/sessions/${sessionId}/members`).set(auth(user)).send(body);

  it("admin only, and validates the request", async () => {
    const session = addSession();
    expect((await addMember(session.id, { userId: MEMBER.id, mode: "USE_CREDIT", bookingType: "GROUP" }, MEMBER)).status).toBe(403);
    for (const body of [
      {},
      { userId: MEMBER.id },
      { userId: MEMBER.id, mode: "FREE" },
      { userId: MEMBER.id, mode: "USE_CREDIT" },
      { userId: MEMBER.id, mode: "USE_CREDIT", bookingType: "GROUP", amount: 100 },
      { userId: MEMBER.id, mode: "PAID_OFFLINE" },
      { userId: MEMBER.id, mode: "PAID_OFFLINE", ratePlanId: groupPlan.id, amount: -5 },
      { userId: MEMBER.id, mode: "PAID_OFFLINE", ratePlanId: groupPlan.id, bookingType: "PRIVATE" },
    ]) {
      const response = await addMember(session.id, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    // Not a registered member.
    for (const userId of ["nobody", ADMIN.id, TUTOR.id]) {
      expect((await addMember(session.id, { userId, mode: "USE_CREDIT", bookingType: "GROUP" })).status).toBe(404);
    }
    expect(fake.tables.booking).toHaveLength(0);
  });

  describe("USE_CREDIT", () => {
    it("uses exactly one credit from the normal selection and links the booking to that membership", async () => {
      const session = addSession();
      const later = addMembership(groupPlan, { expiryDate: utcDay(40), creditsUsed: 1 });
      const sooner = addMembership(groupPlan, { expiryDate: utcDay(20), creditsUsed: 2 });
      const laterBefore = snapshot("memberMembership", later.id);

      const response = await addMember(session.id, { userId: MEMBER.id, mode: "USE_CREDIT", bookingType: "GROUP" });

      expect(response.status, JSON.stringify(response.body)).toBe(201);
      const { booking } = response.body.data;
      expect(response.body.data).toMatchObject({ mode: "USE_CREDIT", bookingType: "GROUP", creditsDeducted: 1, creditsRemaining: 5 });
      expect(booking).toMatchObject({
        userId: MEMBER.id,
        memberMembershipId: sooner.id, // soonest-expiring first, as for members
        membershipId: groupPlan.id,
        amount: 0,
        paymentStatus: "PAID",
        paymentMethod: "OFFLINE",
        bookingStatus: "CONFIRMED",
        fullName: "Mina Member",
        email: MEMBER.email,
        calendarEventId: "evt_1",
      });
      expect(booking.paymentReference).toMatch(/^ADMIN-/);
      expect(fake.get("memberMembership", sooner.id).creditsUsed).toBe(3);
      expect(snapshot("memberMembership", later.id)).toEqual(laterBefore);
      expect(fake.tables.memberMembership).toHaveLength(2);
      expect(fake.tables.user).toHaveLength(4);
      expect(calendar.createBookingEvent).toHaveBeenCalledTimes(1);
      // No declaration is invented on the member's behalf.
      expect(fake.tables.healthSafetyForm).toHaveLength(0);

      const [event] = await events("admin.session.add_member");
      expect(event).toMatchObject({ actorUserId: ADMIN.id, userId: MEMBER.id, entityId: booking.id });
      expect(event.metadata).toMatchObject({ creditMode: "USE_CREDIT", bookingType: "GROUP", memberMembershipId: sooner.id });
      const [deduction] = await events("credit.deduction");
      expect(deduction).toMatchObject({ actorUserId: ADMIN.id, entityId: sooner.id });
    });

    it("unlimited memberships book without using a credit", async () => {
      const session = addSession();
      const unlimited = addMembership(unlimitedPlan, { creditsTotal: null, expiryDate: null });
      const response = await addMember(session.id, { userId: MEMBER.id, mode: "USE_CREDIT", bookingType: "GROUP" });
      expect(response.status).toBe(201);
      expect(response.body.data).toMatchObject({ creditsDeducted: 0, creditsRemaining: null });
      expect(fake.get("memberMembership", unlimited.id).creditsUsed).toBe(0);
    });

    it("a first booking starts an unstarted membership, as for members", async () => {
      const session = addSession({ days: 4 });
      const unstarted = addMembership(groupPlan, { startDate: null, expiryDate: null });
      const response = await addMember(session.id, { userId: MEMBER.id, mode: "USE_CREDIT", bookingType: "GROUP" });
      expect(response.status).toBe(201);
      const row = fake.get("memberMembership", unstarted.id);
      expect(row.startDate).toEqual(session.sessionDate);
      expect(row.expiryDate).not.toBeNull();
      expect(row.creditsUsed).toBe(1);
    });

    it("refuses: no membership of the type, no credits, expired, outside validity", async () => {
      const session = addSession({ days: 10 });
      const none = await addMember(session.id, { userId: MEMBER.id, mode: "USE_CREDIT", bookingType: "PRIVATE" });
      expect(none.status).toBe(400);
      expect(none.body.message).toMatch(/active private membership/);

      const spent = addMembership(groupPlan, { creditsUsed: 8 });
      expect((await addMember(session.id, { userId: MEMBER.id, mode: "USE_CREDIT", bookingType: "GROUP" })).body.message).toMatch(/remaining group class credits/);

      fake.get("memberMembership", spent.id).creditsUsed = 0;
      fake.get("memberMembership", spent.id).expiryDate = utcDay(5); // ends before the session
      expect((await addMember(session.id, { userId: MEMBER.id, mode: "USE_CREDIT", bookingType: "GROUP" })).body.message).toMatch(/outside your membership validity/);

      fake.get("memberMembership", spent.id).expiryDate = utcDay(-1);
      expect((await addMember(session.id, { userId: MEMBER.id, mode: "USE_CREDIT", bookingType: "GROUP" })).status).toBe(400);
      expect(fake.tables.booking).toHaveLength(0);
      expect(fake.get("memberMembership", spent.id).creditsUsed).toBe(0);
    });

    it("cancelling restores the credit to the exact membership used", async () => {
      const session = addSession();
      const a = addMembership(groupPlan, { expiryDate: utcDay(20), creditsUsed: 1 });
      const b = addMembership(groupPlan, { expiryDate: utcDay(40), creditsUsed: 1 });
      const { booking } = (await addMember(session.id, { userId: MEMBER.id, mode: "USE_CREDIT", bookingType: "GROUP" })).body.data;
      expect(fake.get("memberMembership", a.id).creditsUsed).toBe(2);

      const cancelled = await request(app).post(`/api/admin/bookings/${booking.id}/cancel`).set(auth(ADMIN));
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
      expect(fake.get("memberMembership", a.id).creditsUsed).toBe(1);
      expect(fake.get("memberMembership", b.id).creditsUsed).toBe(1);
    });
  });

  describe("PAID_OFFLINE", () => {
    it("links the booking to the member, records the amount, uses no credit and creates no membership", async () => {
      const session = addSession();
      const funded = addMembership(groupPlan, { creditsUsed: 2 });
      const fundedBefore = snapshot("memberMembership", funded.id);

      const response = await addMember(session.id, { userId: MEMBER.id, mode: "PAID_OFFLINE", ratePlanId: groupPlan.id, amount: 7000 });

      expect(response.status, JSON.stringify(response.body)).toBe(201);
      expect(response.body.data).toMatchObject({ mode: "PAID_OFFLINE", bookingType: "GROUP", creditsDeducted: 0, creditsRemaining: null });
      expect(response.body.data.booking).toMatchObject({
        userId: MEMBER.id,
        memberMembershipId: null,
        membershipId: groupPlan.id,
        amount: 7000,
        paymentMethod: "OFFLINE",
        paymentStatus: "PAID",
        bookingStatus: "CONFIRMED",
      });
      expect(snapshot("memberMembership", funded.id)).toEqual(fundedBefore);
      expect(fake.tables.memberMembership).toHaveLength(1);
      expect(fake.tables.user).toHaveLength(4);
      expect(fake.tables.membershipPurchase).toHaveLength(0);
      expect(await events("credit.deduction")).toHaveLength(0);
    });

    it("works for a member with no membership; the amount defaults to the rate's price", async () => {
      const session = addSession();
      const response = await addMember(session.id, { userId: OTHER.id, mode: "PAID_OFFLINE", ratePlanId: privatePlan.id });
      expect(response.status).toBe(201);
      expect(response.body.data).toMatchObject({ bookingType: "PRIVATE", booking: { amount: 40000, userId: OTHER.id } });
      expect(fake.tables.memberMembership).toHaveLength(0);
    });

    it("cancelling restores no credit (none was used)", async () => {
      const session = addSession();
      const funded = addMembership(groupPlan, { creditsUsed: 2 });
      const { booking } = (await addMember(session.id, { userId: MEMBER.id, mode: "PAID_OFFLINE", ratePlanId: groupPlan.id, amount: 7000 })).body.data;

      const byMember = await request(app).post(`/api/bookings/${booking.id}/cancel`).set(auth(MEMBER));
      expect(byMember.status, JSON.stringify(byMember.body)).toBe(200);
      expect(fake.get("memberMembership", funded.id).creditsUsed).toBe(2);
      expect(fake.get("booking", booking.id).bookingStatus).toBe("CANCELLED");
    });
  });

  describe("both modes", () => {
    it("count toward capacity, appear in the member's history and admin session views", async () => {
      const session = addSession({ capacity: 3 });
      addMembership(groupPlan);
      addConfirmed(session, groupPlan);
      await addMember(session.id, { userId: MEMBER.id, mode: "USE_CREDIT", bookingType: "GROUP" });
      await addMember(session.id, { userId: OTHER.id, mode: "PAID_OFFLINE", ratePlanId: groupPlan.id });

      const listed = (await request(app).get("/api/admin/sessions").set(auth(ADMIN))).body.data;
      const row = (Array.isArray(listed) ? listed : listed.sessions).find((item: any) => item.id === session.id);
      expect(row).toMatchObject({ bookedCount: 3, availableSlots: 0 });
      expect(row.bookings.map((item: any) => item.userId)).toEqual(expect.arrayContaining([MEMBER.id, OTHER.id]));

      for (const user of [MEMBER, OTHER]) {
        const mine = await request(app).get("/api/bookings/my").set(auth(user));
        expect(mine.body.data.bookings.map((item: any) => item.sessionId)).toContain(session.id);
      }

      // Full now, for any mode and for offline attendees.
      const full = await addMember(session.id, { userId: OTHER.id, mode: "PAID_OFFLINE", ratePlanId: groupPlan.id });
      expect(full.status).toBe(400);
    });

    it("duplicates are refused across modes, and private rules apply", async () => {
      const session = addSession();
      addMembership(groupPlan);
      expect((await addMember(session.id, { userId: MEMBER.id, mode: "PAID_OFFLINE", ratePlanId: groupPlan.id })).status).toBe(201);
      const duplicate = await addMember(session.id, { userId: MEMBER.id, mode: "USE_CREDIT", bookingType: "GROUP" });
      expect(duplicate.status).toBe(400);
      expect(duplicate.body.message).toBe("You are already booked for this session.");

      const privateSession = addSession({ days: 4 });
      addConfirmed(privateSession, groupPlan);
      const occupied = await addMember(privateSession.id, { userId: OTHER.id, mode: "PAID_OFFLINE", ratePlanId: privatePlan.id });
      expect(occupied.body.message).toBe("This session is already occupied and cannot be booked privately.");
    });

    it("keeps the member booking's two-hour rule", async () => {
      const soon = addSession({ days: 0, startTime: "00:00", endTime: "23:59" });
      const response = await addMember(soon.id, { userId: OTHER.id, mode: "PAID_OFFLINE", ratePlanId: groupPlan.id });
      expect(response.status).toBe(400);
      expect(response.body.message).toBe("This session must start at least two hours from now.");
    });
  });
});

// =====================================================================
// 3. Remove credits
// =====================================================================

describe("POST /api/admin/members/:memberId/memberships/:memberMembershipId/credits/remove", () => {
  const remove = (membership: any, body: any, user: any = ADMIN, memberId = MEMBER.id) =>
    request(app)
      .post(`/api/admin/members/${memberId}/memberships/${membership.id}/credits/remove`)
      .set(auth(user))
      .send(body);

  it.each([
    [10, 0, 1, 9],
    [5, 0, 2, 3],
    [1, 0, 1, 0],
    [10, 3, 2, 5],
  ])("total %i, used %i, remove %i -> %i remaining (creditsTotal lowered, creditsUsed kept)", async (total, used, credits, remaining) => {
    const row = addMembership(groupPlan, { creditsTotal: total, creditsUsed: used });
    const before = snapshot("memberMembership", row.id);

    const response = await remove(row, { credits, expectedRemaining: total - used });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.data).toMatchObject({
      memberMembershipId: row.id,
      userId: MEMBER.id,
      creditsRemoved: credits,
      previous: { creditsTotal: total, creditsUsed: used, remainingCredits: total - used },
      updated: { creditsTotal: total - credits, creditsUsed: used, remainingCredits: remaining },
    });
    const after = fake.get("memberMembership", row.id);
    expect(after).toMatchObject({ creditsTotal: total - credits, creditsUsed: used });
    expect(after.startDate).toEqual(before.startDate);
    expect(after.expiryDate).toEqual(before.expiryDate);
    expect(after.status).toBe("ACTIVE");
  });

  it("changes no other membership and no booking", async () => {
    const target = addMembership(groupPlan, { creditsTotal: 8, creditsUsed: 1 });
    const other = addMembership(groupPlan, { creditsTotal: 8, creditsUsed: 4 });
    const privateRow = addMembership(privatePlan, { creditsTotal: 4, creditsUsed: 0 });
    const booking = addConfirmed(addSession(), groupPlan, { userId: MEMBER.id, memberMembershipId: target.id });
    const untouched = [snapshot("memberMembership", other.id), snapshot("memberMembership", privateRow.id), snapshot("booking", booking.id)];

    expect((await remove(target, { credits: 3, expectedRemaining: 7 })).status).toBe(200);

    expect([snapshot("memberMembership", other.id), snapshot("memberMembership", privateRow.id), snapshot("booking", booking.id)]).toEqual(untouched);

    // Pools read the new balance: 4 + 4 GROUP remaining.
    const summary = (await request(app).get("/api/bookings/my/credits").set(auth(MEMBER))).body.data;
    expect(summary.creditPools.GROUP.remainingCredits).toBe(8);
    expect(summary.creditPools.PRIVATE.remainingCredits).toBe(4);
  });

  it("validates the amount and the expected balance", async () => {
    const row = addMembership(groupPlan, { creditsTotal: 5, creditsUsed: 0 });
    for (const body of [
      { credits: 0, expectedRemaining: 5 },
      { credits: -1, expectedRemaining: 5 },
      { credits: 1.5, expectedRemaining: 5 },
      { credits: "2", expectedRemaining: 5 },
      { credits: null, expectedRemaining: 5 },
      { expectedRemaining: 5 },
      { credits: 1 },
      { credits: 1, expectedRemaining: -1 },
      { credits: 1, expectedRemaining: "5" },
    ]) {
      const response = await remove(row, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
    }
    expect(fake.get("memberMembership", row.id).creditsTotal).toBe(5);
  });

  it("never removes more than the unused credits, nor credits already spent", async () => {
    const row = addMembership(groupPlan, { creditsTotal: 5, creditsUsed: 4 });
    const response = await remove(row, { credits: 2, expectedRemaining: 1 });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "INSUFFICIENT_CREDITS", message: "Only 1 unused credit can be removed." });

    const empty = addMembership(groupPlan, { creditsTotal: 3, creditsUsed: 3 });
    expect((await remove(empty, { credits: 1, expectedRemaining: 0 })).body.code).toBe("INSUFFICIENT_CREDITS");
    expect(fake.get("memberMembership", row.id)).toMatchObject({ creditsTotal: 5, creditsUsed: 4 });
  });

  it("rejects a stale balance (it changed after the admin opened the form)", async () => {
    const row = addMembership(groupPlan, { creditsTotal: 10, creditsUsed: 3 });
    const response = await remove(row, { credits: 2, expectedRemaining: 8 });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "STALE_BALANCE" });
    expect(response.body.message).toMatch(/now 7 remaining/);
    expect(fake.get("memberMembership", row.id).creditsTotal).toBe(10);

    // A double submit: the second sees the new balance and is refused.
    expect((await remove(row, { credits: 2, expectedRemaining: 7 })).status).toBe(200);
    expect((await remove(row, { credits: 2, expectedRemaining: 7 })).body.code).toBe("STALE_BALANCE");
    expect(fake.get("memberMembership", row.id).creditsTotal).toBe(8);
  });

  it("rejects unlimited, expired, inactive, unknown and other members' memberships", async () => {
    const unlimited = addMembership(unlimitedPlan, { creditsTotal: null });
    expect((await remove(unlimited, { credits: 1, expectedRemaining: 0 })).body.code).toBe("UNLIMITED_MEMBERSHIP");

    const expired = addMembership(groupPlan, { expiryDate: utcDay(-1) });
    expect((await remove(expired, { credits: 1, expectedRemaining: 8 })).body.code).toBe("MEMBERSHIP_NOT_ACTIVE");

    const replaced = addMembership(groupPlan, { status: "EXPIRED" });
    expect((await remove(replaced, { credits: 1, expectedRemaining: 8 })).body.code).toBe("MEMBERSHIP_NOT_ACTIVE");

    const mine = addMembership(groupPlan);
    const wrongMember = await remove(mine, { credits: 1, expectedRemaining: 8 }, ADMIN, OTHER.id);
    expect(wrongMember.status).toBe(404);
    expect((await remove({ id: "missing" }, { credits: 1, expectedRemaining: 8 })).status).toBe(404);

    expect((await remove(mine, { credits: 1, expectedRemaining: 8 }, MEMBER)).status).toBe(403);
    expect(fake.get("memberMembership", mine.id).creditsTotal).toBe(8);
  });

  it("offline memberships (no account) are addressed by their own ID", async () => {
    const offline = addMembership(groupPlan, { userId: null, creditsTotal: 6, creditsUsed: 1 });
    const response = await remove(offline, { credits: 1, expectedRemaining: 5 }, ADMIN, offline.id);
    expect(response.status).toBe(200);
    expect(fake.get("memberMembership", offline.id).creditsTotal).toBe(5);
  });

  it("records who removed what, with before and after balances", async () => {
    const row = addMembership(groupPlan, { creditsTotal: 10, creditsUsed: 3 });
    await remove(row, { credits: 2, expectedRemaining: 7 });

    for (const action of ["admin.membership.remove_credits", "credit.admin_removal"]) {
      const [event] = await events(action);
      expect(event).toMatchObject({
        actorType: "ADMIN",
        actorUserId: ADMIN.id,
        userId: MEMBER.id,
        entityType: "MEMBER_MEMBERSHIP",
        entityId: row.id,
        status: "SUCCESS",
      });
      expect(event.metadata).toMatchObject({
        memberMembershipId: row.id,
        creditsRemoved: 2,
        previousCreditsTotal: 10,
        previousCreditsRemaining: 7,
        creditsTotal: 8,
        creditsUsed: 3,
        creditsRemaining: 5,
      });
      expect(event.createdAt).toBeInstanceOf(Date);
    }
  });

  it("later bookings and cancellations keep working on the reduced balance", async () => {
    const row = addMembership(groupPlan, { creditsTotal: 3, creditsUsed: 0 });
    await remove(row, { credits: 2, expectedRemaining: 3 });
    const session = addSession();

    const booked = await request(app)
      .post("/api/bookings/member-session")
      .set(auth(MEMBER))
      .send({ classSessionId: session.id, bookingType: "GROUP", healthDeclaration: { accepted: true } });
    expect(booked.status, JSON.stringify(booked.body)).toBe(201);
    expect(fake.get("memberMembership", row.id)).toMatchObject({ creditsTotal: 1, creditsUsed: 1 });

    // No credit left now.
    const second = addSession({ days: 4 });
    const refused = await request(app)
      .post("/api/bookings/member-session")
      .set(auth(MEMBER))
      .send({ classSessionId: second.id, bookingType: "GROUP", healthDeclaration: { accepted: true } });
    expect(refused.status).toBe(400);

    const bookingId = fake.tables.booking.find((item: any) => item.sessionId === session.id).id;
    expect((await request(app).post(`/api/bookings/${bookingId}/cancel`).set(auth(MEMBER))).status).toBe(200);
    expect(fake.get("memberMembership", row.id)).toMatchObject({ creditsTotal: 1, creditsUsed: 0 });
  });
});
