/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed fake rows and HTTP bodies */
/**
 * Pooled credit removal:
 *   POST /api/admin/members/:memberId/credit-pools/:type/credits/remove
 *
 * Through the real app (auth, routes, controller, service, audit) over the
 * in-memory fake Prisma; real-database locking and concurrency are in
 * tests/postgres/admin-credit-pools.pg.test.ts. The single-record endpoint
 * is covered, unchanged, in admin-session-bookings.test.ts.
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
let allocatePoolRemoval: any;
let tokenFor: (user: any) => string;

const DAY = 86_400_000;
const ADMIN = { id: "admin_1", email: "admin@example.com", role: "ADMIN" };
const MEMBER = { id: "member_1", email: "mina@example.com", role: "MEMBER" };
const OTHER = { id: "member_2", email: "otto@example.com", role: "MEMBER" };

const auth = (user: any) => ({ Authorization: `Bearer ${tokenFor(user)}` });
const utcDay = (offsetDays: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + offsetDays * DAY);
};

let groupPlan: any;
let privatePlan: any;
let unlimitedPlan: any;

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

function addSession(days = 3) {
  const schedule = fake.insert("schedule", {
    className: "Reformer",
    tutorName: "Tess",
    code: `S${fake.tables.schedule.length + 1}`,
    dayOfWeek: "MONDAY",
    startTime: "10:00",
    endTime: "11:00",
    capacity: 5,
    isActive: true,
  });
  return fake.insert("classSession", { scheduleId: schedule.id, sessionDate: utcDay(days), status: "OPEN" });
}

const removePool = (type: string, body: any, user: any = ADMIN, memberId = MEMBER.id) =>
  request(app)
    .post(`/api/admin/members/${memberId}/credit-pools/${type}/credits/remove`)
    .set(auth(user))
    .send(body);

const row = (id: string) => fake.get("memberMembership", id);
const snapshot = (id: string) => ({ ...row(id) });
const events = async (action: string) => {
  await activityLog.flush();
  return fake.tables.memberActivityLog.filter((item: any) => item.action === action);
};

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  app = (await import("../../src/app.js")).default;
  activityLog = (await import("../../src/activity-log/activity-log.service.js")).activityLog;
  allocatePoolRemoval = (await import("../../src/admin/admin-credits.service.js")).allocatePoolRemoval;
  const { generateAccessToken } = await import("../../src/utils/jwt.js");
  tokenFor = (user) => generateAccessToken({ userId: user.id, email: user.email, role: user.role } as any);
}, 60_000);

beforeEach(async () => {
  await activityLog?.flush();
  fake.reset();
  for (const user of [ADMIN, MEMBER, OTHER]) {
    fake.insert("user", { ...user, fullName: user.id === MEMBER.id ? "Mina Member" : user.id, phone: "08000000000", password: "x" });
  }
  groupPlan = fake.insert("membership", { name: "Group 8", slug: "group-8", type: "GROUP", price: 15000, period: "/month", classLimit: 8, duration: "Monthly", isActive: true, features: [] });
  privatePlan = fake.insert("membership", { name: "Private 4", slug: "private-4", type: "PRIVATE", price: 40000, period: "/month", classLimit: 4, duration: "Monthly", isActive: true, features: [] });
  unlimitedPlan = fake.insert("membership", { name: "Unlimited", slug: "unlimited", type: "GROUP", price: 90000, period: "/month", classLimit: null, duration: "Monthly", isActive: true, features: [] });
});

// =====================================================================
// Allocation order (pure)
// =====================================================================

describe("allocatePoolRemoval", () => {
  const at = (days: number) => utcDay(days);
  const r = (id: string, remaining: number, started: boolean, expiryDays: number | null, createdDays: number) => ({
    id,
    remaining,
    started,
    expiryDate: expiryDays === null ? null : at(expiryDays),
    createdAt: at(createdDays),
  });

  it("the worked example: 3 from the original, 1 from the next", () => {
    expect(allocatePoolRemoval([r("upgrade", 5, true, 40, -1), r("original", 3, true, 10, -20)], 4)).toEqual([
      { id: "original", credits: 3 },
      { id: "upgrade", credits: 1 },
    ]);
  });

  it("started rows: soonest expiry first, rows with no expiry after the dated ones", () => {
    const rows = [r("none", 4, true, null, -30), r("late", 4, true, 60, -10), r("soon", 4, true, 5, -1)];
    expect(allocatePoolRemoval(rows, 10)).toEqual([
      { id: "soon", credits: 4 },
      { id: "late", credits: 4 },
      { id: "none", credits: 2 },
    ]);
  });

  it("rows awaiting their first booking go last, after every started row", () => {
    const rows = [r("awaiting", 5, false, null, -30), r("started", 2, true, null, -1)];
    expect(allocatePoolRemoval(rows, 3)).toEqual([
      { id: "started", credits: 2 },
      { id: "awaiting", credits: 1 },
    ]);
  });

  it("awaiting rows: oldest first, but an older one is never emptied while a newer one keeps credits", () => {
    const head = r("head", 5, false, null, -10);
    const renewal = r("renewal", 5, false, null, -2);
    // Down to 1 in each, oldest first...
    expect(allocatePoolRemoval([renewal, head], 4)).toEqual([{ id: "head", credits: 4 }]);
    expect(allocatePoolRemoval([renewal, head], 5)).toEqual([
      { id: "head", credits: 4 },
      { id: "renewal", credits: 1 },
    ]);
    // ...then the last credits, newest first.
    expect(allocatePoolRemoval([renewal, head], 9)).toEqual([
      { id: "head", credits: 4 },
      { id: "renewal", credits: 5 },
    ]);
    expect(allocatePoolRemoval([renewal, head], 10)).toEqual([
      { id: "head", credits: 5 },
      { id: "renewal", credits: 5 },
    ]);
  });

  it("rows with nothing left are skipped; it never takes more than a row has", () => {
    const rows = [r("empty", 0, true, 1, -9), r("one", 1, false, null, -5), r("two", 2, true, 9, -3)];
    expect(allocatePoolRemoval(rows, 3)).toEqual([
      { id: "two", credits: 2 },
      { id: "one", credits: 1 },
    ]);
    expect(() => allocatePoolRemoval(rows, 4)).toThrow(/Not enough/);
  });
});

// =====================================================================
// HTTP
// =====================================================================

describe("POST /api/admin/members/:memberId/credit-pools/:type/credits/remove", () => {
  it("one record in the pool: same result as removing from that record", async () => {
    const only = addMembership(groupPlan, { creditsTotal: 10, creditsUsed: 3 });
    const before = snapshot(only.id);

    const response = await removePool("GROUP", { credits: 2, expectedRemaining: 7 });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({ success: true, message: "2 credits removed. 5 remaining." });
    expect(response.body.data).toMatchObject({
      memberId: MEMBER.id,
      userId: MEMBER.id,
      membershipType: "GROUP",
      creditsRemoved: 2,
      previous: { poolRemaining: 7 },
      updated: { poolRemaining: 5 },
      recordsInPool: 1,
      allocations: [
        {
          memberMembershipId: only.id,
          membershipName: "Group 8",
          creditsRemoved: 2,
          previous: { creditsTotal: 10, creditsUsed: 3, remainingCredits: 7 },
          updated: { creditsTotal: 8, creditsUsed: 3, remainingCredits: 5 },
        },
      ],
    });
    expect(row(only.id)).toMatchObject({ ...before, creditsTotal: 8, updatedAt: expect.anything() });
  });

  it("two records (the worked example): 3 from the original, 1 from the renewal; pool 8 -> 4", async () => {
    const original = addMembership(groupPlan, { creditsTotal: 5, creditsUsed: 2, startDate: utcDay(-20), expiryDate: utcDay(10) });
    const renewal = addMembership(groupPlan, { creditsTotal: 5, creditsUsed: 0, startDate: utcDay(10), expiryDate: utcDay(40) });
    const [o, n] = [snapshot(original.id), snapshot(renewal.id)];

    const response = await removePool("GROUP", { credits: 4, expectedRemaining: 8 });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.message).toBe("4 credits removed. 4 remaining.");
    expect(response.body.data).toMatchObject({
      previous: { poolRemaining: 8 },
      updated: { poolRemaining: 4 },
      recordsInPool: 2,
      allocations: [
        { memberMembershipId: original.id, creditsRemoved: 3, previous: { creditsTotal: 5, creditsUsed: 2, remainingCredits: 3 }, updated: { creditsTotal: 2, creditsUsed: 2, remainingCredits: 0 } },
        { memberMembershipId: renewal.id, creditsRemoved: 1, previous: { creditsTotal: 5, creditsUsed: 0, remainingCredits: 5 }, updated: { creditsTotal: 4, creditsUsed: 0, remainingCredits: 4 } },
      ],
    });

    // Only creditsTotal changes: usage, dates and status are kept.
    for (const [saved, was, total] of [[row(original.id), o, 2], [row(renewal.id), n, 4]] as const) {
      expect(saved).toMatchObject({ creditsTotal: total, creditsUsed: was.creditsUsed, status: "ACTIVE" });
      expect(saved.startDate).toEqual(was.startDate);
      expect(saved.expiryDate).toEqual(was.expiryDate);
    }

    // The member's own summary reads the new balances: none usable now,
    // 4 on the renewal that starts later (the admin pool counts both).
    const summary = (await request(app).get("/api/bookings/my/credits").set(auth(MEMBER))).body.data;
    expect(summary.creditPools.GROUP.remainingCredits).toBe(0);
    expect(summary.creditPools.GROUP.queued.remainingCredits).toBe(4);
  });

  it("three or more records, in expiry order", async () => {
    const a = addMembership(groupPlan, { creditsTotal: 4, creditsUsed: 2, expiryDate: utcDay(5) }); // 2
    const c = addMembership(groupPlan, { creditsTotal: 4, creditsUsed: 0, expiryDate: utcDay(60) }); // 4
    const b = addMembership(groupPlan, { creditsTotal: 5, creditsUsed: 2, expiryDate: utcDay(30) }); // 3
    const d = addMembership(groupPlan, { creditsTotal: 2, creditsUsed: 0, expiryDate: null }); // 2

    const response = await removePool("GROUP", { credits: 6, expectedRemaining: 11 });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.data.allocations.map((item: any) => [item.memberMembershipId, item.creditsRemoved])).toEqual([
      [a.id, 2],
      [b.id, 3],
      [c.id, 1],
    ]);
    expect([a, b, c, d].map((item) => row(item.id).creditsTotal)).toEqual([2, 2, 3, 2]);
    expect(response.body.data.updated.poolRemaining).toBe(5);
  });

  it("removing exactly the combined balance leaves every record at zero, never below its used credits", async () => {
    const a = addMembership(groupPlan, { creditsTotal: 5, creditsUsed: 2 });
    const b = addMembership(groupPlan, { creditsTotal: 5, creditsUsed: 0, expiryDate: utcDay(40) });

    const response = await removePool("GROUP", { credits: 8, expectedRemaining: 8 });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.data.updated.poolRemaining).toBe(0);
    expect(row(a.id)).toMatchObject({ creditsTotal: 2, creditsUsed: 2 });
    expect(row(b.id)).toMatchObject({ creditsTotal: 0, creditsUsed: 0 });
  });

  it("refuses more than the combined balance and changes nothing", async () => {
    const a = addMembership(groupPlan, { creditsTotal: 5, creditsUsed: 2 });
    const b = addMembership(groupPlan, { creditsTotal: 5, creditsUsed: 0, expiryDate: utcDay(40) });

    const response = await removePool("GROUP", { credits: 9, expectedRemaining: 8 });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, code: "INSUFFICIENT_CREDITS", message: "Only 8 unused credits can be removed." });
    expect(row(a.id).creditsTotal).toBe(5);
    expect(row(b.id).creditsTotal).toBe(5);
  });

  it("used credits are never removed: an over-used record counts as zero and is left alone", async () => {
    const overused = addMembership(groupPlan, { creditsTotal: 3, creditsUsed: 5, expiryDate: utcDay(2) });
    const normal = addMembership(groupPlan, { creditsTotal: 6, creditsUsed: 1, expiryDate: utcDay(30) });

    const response = await removePool("GROUP", { credits: 5, expectedRemaining: 5 });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.data.allocations).toHaveLength(1);
    expect(row(overused.id)).toMatchObject({ creditsTotal: 3, creditsUsed: 5 });
    expect(row(normal.id)).toMatchObject({ creditsTotal: 1, creditsUsed: 1 });
  });

  it("expired and inactive records are not in the pool and are never changed", async () => {
    const active = addMembership(groupPlan, { creditsTotal: 6, creditsUsed: 0 });
    const expired = addMembership(groupPlan, { creditsTotal: 8, creditsUsed: 0, expiryDate: utcDay(-1) });
    const replaced = addMembership(groupPlan, { creditsTotal: 8, creditsUsed: 0, status: "EXPIRED" });
    const untouched = [snapshot(expired.id), snapshot(replaced.id)];

    // A balance that counts them is stale.
    const stale = await removePool("GROUP", { credits: 1, expectedRemaining: 22 });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("STALE_BALANCE");

    const response = await removePool("GROUP", { credits: 6, expectedRemaining: 6 });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.data.recordsInPool).toBe(1);
    expect(row(active.id).creditsTotal).toBe(0);
    expect([snapshot(expired.id), snapshot(replaced.id)]).toEqual(untouched);

    // An emptied record stays ACTIVE with 0: nothing more to remove.
    const empty = await removePool("GROUP", { credits: 1, expectedRemaining: 0 });
    expect(empty.status).toBe(400);
    expect(empty.body.code).toBe("INSUFFICIENT_CREDITS");

    // A member with only expired GROUP and an active PRIVATE: no GROUP pool.
    addMembership(groupPlan, { userId: OTHER.id, expiryDate: utcDay(-1) });
    addMembership(privatePlan, { userId: OTHER.id });
    const none = await removePool("GROUP", { credits: 1, expectedRemaining: 0 }, ADMIN, OTHER.id);
    expect(none.status).toBe(409);
    expect(none.body.code).toBe("MEMBERSHIP_NOT_ACTIVE");
  });

  it("a GROUP removal never touches PRIVATE records, and the reverse", async () => {
    const group = addMembership(groupPlan, { creditsTotal: 8, creditsUsed: 0 });
    const privateRow = addMembership(privatePlan, { creditsTotal: 4, creditsUsed: 1, expiryDate: utcDay(1) });
    const otherMember = addMembership(groupPlan, { userId: OTHER.id, creditsTotal: 8, creditsUsed: 0, expiryDate: utcDay(1) });
    const before = [snapshot(privateRow.id), snapshot(otherMember.id)];

    const response = await removePool("GROUP", { credits: 8, expectedRemaining: 8 });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(row(group.id).creditsTotal).toBe(0);
    expect([snapshot(privateRow.id), snapshot(otherMember.id)]).toEqual(before);

    // The type is case-insensitive in the URL.
    const privateResponse = await removePool("private", { credits: 1, expectedRemaining: 3 });
    expect(privateResponse.status, JSON.stringify(privateResponse.body)).toBe(200);
    expect(privateResponse.body.data.membershipType).toBe("PRIVATE");
    expect(row(privateRow.id).creditsTotal).toBe(3);
    expect(row(group.id).creditsTotal).toBe(0);
  });

  it("rejects a stale combined balance, including a double submit", async () => {
    const a = addMembership(groupPlan, { creditsTotal: 5, creditsUsed: 2 });
    addMembership(groupPlan, { creditsTotal: 5, creditsUsed: 0, expiryDate: utcDay(40) });

    // One record's balance is not the pool's.
    const response = await removePool("GROUP", { credits: 1, expectedRemaining: 3 });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "STALE_BALANCE" });
    expect(response.body.message).toMatch(/now 8 remaining/);
    expect(row(a.id).creditsTotal).toBe(5);

    expect((await removePool("GROUP", { credits: 2, expectedRemaining: 8 })).status).toBe(200);
    const again = await removePool("GROUP", { credits: 2, expectedRemaining: 8 });
    expect(again.body.code).toBe("STALE_BALANCE");
    expect(again.body.message).toMatch(/now 6 remaining/);
  });

  it("rolls back every record when a later record's update fails", async () => {
    const a = addMembership(groupPlan, { creditsTotal: 5, creditsUsed: 2, expiryDate: utcDay(10) });
    const b = addMembership(groupPlan, { creditsTotal: 5, creditsUsed: 0, expiryDate: utcDay(40) });
    const updateMany = fake.prisma.memberMembership.updateMany;
    const real = updateMany.getMockImplementation();

    // The second conditional update matches nothing (the row changed).
    updateMany.mockImplementationOnce(real).mockImplementationOnce(async () => ({ count: 0 }));
    const missed = await removePool("GROUP", { credits: 4, expectedRemaining: 8 });
    expect(missed.status).toBe(409);
    expect(missed.body.code).toBe("STALE_BALANCE");
    expect(row(a.id).creditsTotal).toBe(5);
    expect(row(b.id).creditsTotal).toBe(5);

    // The second update throws (e.g. a database error).
    updateMany.mockImplementationOnce(real).mockImplementationOnce(async () => {
      throw new Error("connection lost");
    });
    const failed = await removePool("GROUP", { credits: 4, expectedRemaining: 8 });
    expect(failed.status).toBe(500);
    expect(failed.body.success).toBe(false);
    expect(row(a.id).creditsTotal).toBe(5);
    expect(row(b.id).creditsTotal).toBe(5);

    // Nothing was recorded as removed.
    expect(await events("admin.membership.remove_pool_credits")).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ status: "SUCCESS" })])
    );
    expect(await events("credit.admin_removal")).toHaveLength(0);
  });

  it("protects an unstarted renewal chain: the oldest awaiting record keeps a credit while a newer one has any", async () => {
    // Neither has had its first booking: the first booking starts the head.
    const head = addMembership(groupPlan, { creditsTotal: 5, creditsUsed: 0, startDate: null, expiryDate: null });
    const renewal = addMembership(groupPlan, { creditsTotal: 5, creditsUsed: 0, startDate: null, expiryDate: null });

    const response = await removePool("GROUP", { credits: 5, expectedRemaining: 10 });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(row(head.id).creditsTotal).toBe(1);
    expect(row(renewal.id).creditsTotal).toBe(4);
    expect(row(head.id).startDate).toBeNull();
    expect(row(renewal.id).startDate).toBeNull();

    // The member's next booking still starts the head (and the chain behind it).
    const session = addSession();
    const booked = await request(app)
      .post("/api/bookings/member-session")
      .set(auth(MEMBER))
      .send({ classSessionId: session.id, bookingType: "GROUP", healthDeclaration: { accepted: true } });
    expect(booked.status, JSON.stringify(booked.body)).toBe(201);
    expect(row(head.id)).toMatchObject({ creditsUsed: 1 });
    expect(row(head.id).startDate).not.toBeNull();
  });

  it("started records are used before an unstarted one", async () => {
    const awaiting = addMembership(groupPlan, { creditsTotal: 5, creditsUsed: 0, startDate: null, expiryDate: null });
    const current = addMembership(groupPlan, { creditsTotal: 5, creditsUsed: 1, startDate: utcDay(-3), expiryDate: utcDay(27) });

    const response = await removePool("GROUP", { credits: 5, expectedRemaining: 9 });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(row(current.id).creditsTotal).toBe(1); // all 4 of its credits
    expect(row(awaiting.id).creditsTotal).toBe(4); // then 1
  });

  it("records the pool event and one event per affected record, with each deduction", async () => {
    const a = addMembership(groupPlan, { creditsTotal: 5, creditsUsed: 2, expiryDate: utcDay(10) });
    const b = addMembership(groupPlan, { creditsTotal: 5, creditsUsed: 0, expiryDate: utcDay(40) });
    const untouched = addMembership(groupPlan, { creditsTotal: 3, creditsUsed: 0, expiryDate: null });
    await removePool("GROUP", { credits: 4, expectedRemaining: 11 });

    const [summary] = await events("admin.membership.remove_pool_credits");
    expect(summary).toMatchObject({
      stage: "SUCCEEDED",
      status: "SUCCESS",
      actorType: "ADMIN",
      actorUserId: ADMIN.id,
      userId: MEMBER.id,
      entityType: "USER",
      entityId: MEMBER.id,
    });
    expect(summary.metadata).toMatchObject({
      membershipType: "GROUP",
      creditsRemoved: 4,
      previousPoolRemaining: 11,
      poolRemaining: 7,
      recordsAffected: 2,
    });
    expect(summary.metadata.droppedFields).toBeUndefined();

    const perRecord = await events("credit.admin_removal");
    expect(perRecord.map((event: any) => event.entityId).sort()).toEqual([a.id, b.id].sort());
    expect(perRecord.some((event: any) => event.entityId === untouched.id)).toBe(false);
    const byId = Object.fromEntries(perRecord.map((event: any) => [event.entityId, event]));
    expect(byId[a.id]).toMatchObject({ userId: MEMBER.id, actorUserId: ADMIN.id, entityType: "MEMBER_MEMBERSHIP" });
    expect(byId[a.id].metadata).toMatchObject({
      source: "credit_pool",
      membershipType: "GROUP",
      memberMembershipId: a.id,
      creditsRemoved: 3,
      previousCreditsTotal: 5,
      previousCreditsRemaining: 3,
      creditsTotal: 2,
      creditsUsed: 2,
      creditsRemaining: 0,
      previousPoolRemaining: 11,
      poolRemaining: 7,
    });
    expect(byId[b.id].metadata).toMatchObject({ creditsRemoved: 1, previousCreditsTotal: 5, creditsTotal: 4, creditsRemaining: 4 });
    for (const event of perRecord) expect(event.metadata.droppedFields).toBeUndefined();
    // All events of the request join one operation.
    expect(new Set([summary, ...perRecord].map((event: any) => event.correlationId)).size).toBe(1);
  });

  it("records a failed attempt against the member", async () => {
    addMembership(groupPlan, { creditsTotal: 5, creditsUsed: 0 });
    await removePool("GROUP", { credits: 1, expectedRemaining: 4 });
    const [failed] = await events("admin.membership.remove_pool_credits");
    expect(failed).toMatchObject({ stage: "FAILED", status: "FAILURE", userId: MEMBER.id, errorCode: "STALE_BALANCE", httpStatus: 409 });
  });

  it("validates the type, the amount and the expected balance", async () => {
    const a = addMembership(groupPlan, { creditsTotal: 5, creditsUsed: 0 });
    for (const [type, body] of [
      ["SOLO", { credits: 1, expectedRemaining: 5 }],
      ["GROUP", { credits: 0, expectedRemaining: 5 }],
      ["GROUP", { credits: 1.5, expectedRemaining: 5 }],
      ["GROUP", { credits: "2", expectedRemaining: 5 }],
      ["GROUP", { expectedRemaining: 5 }],
      ["GROUP", { credits: 1 }],
      ["GROUP", { credits: 1, expectedRemaining: -1 }],
      ["GROUP", { credits: 1, expectedRemaining: "5" }],
    ] as const) {
      const response = await removePool(type, body);
      expect(response.status, JSON.stringify({ type, body })).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
    }
    expect(row(a.id).creditsTotal).toBe(5);
  });

  it("admin only; unknown members, unlimited pools and offline memberships", async () => {
    const a = addMembership(groupPlan, { creditsTotal: 5, creditsUsed: 0 });
    expect((await removePool("GROUP", { credits: 1, expectedRemaining: 5 }, MEMBER)).status).toBe(403);
    expect((await removePool("GROUP", { credits: 1, expectedRemaining: 5 }, ADMIN, "missing")).body.code).toBe("MEMBER_NOT_FOUND");
    expect(row(a.id).creditsTotal).toBe(5);

    // Any unlimited record makes the pool unlimited.
    addMembership(unlimitedPlan, { creditsTotal: null });
    const unlimited = await removePool("GROUP", { credits: 1, expectedRemaining: 5 });
    expect(unlimited.status).toBe(409);
    expect(unlimited.body.code).toBe("UNLIMITED_MEMBERSHIP");
    expect(row(a.id).creditsTotal).toBe(5);

    // An offline membership (no account) is its own pool, addressed by its ID.
    const offline = addMembership(groupPlan, { userId: null, creditsTotal: 6, creditsUsed: 1 });
    const response = await removePool("GROUP", { credits: 2, expectedRemaining: 5 }, ADMIN, offline.id);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.data).toMatchObject({ memberId: offline.id, userId: null, updated: { poolRemaining: 3 } });
    expect(row(offline.id).creditsTotal).toBe(4);
    const [summary] = (await events("admin.membership.remove_pool_credits")).filter((event: any) => event.status === "SUCCESS");
    expect(summary).toMatchObject({ entityType: "MEMBER_MEMBERSHIP", entityId: offline.id, userId: null });
  });

  describe("preview (POST …/credit-pools/:type/credits/preview)", () => {
    const preview = (type: string, body: any, user: any = ADMIN, memberId = MEMBER.id) =>
      request(app)
        .post(`/api/admin/members/${memberId}/credit-pools/${type}/credits/preview`)
        .set(auth(user))
        .send(body);

    it("returns exactly what the removal then does, and writes nothing", async () => {
      const head = addMembership(groupPlan, { creditsTotal: 5, creditsUsed: 0, startDate: null, expiryDate: null });
      const original = addMembership(groupPlan, { creditsTotal: 5, creditsUsed: 2, expiryDate: utcDay(10) });
      const renewal = addMembership(groupPlan, { creditsTotal: 5, creditsUsed: 0, expiryDate: utcDay(40) });
      const before = [snapshot(head.id), snapshot(original.id), snapshot(renewal.id)];
      const updateMany = fake.prisma.memberMembership.updateMany;
      const writes = updateMany.mock.calls.length;

      const previewed = await preview("GROUP", { credits: 10, expectedRemaining: 13 });
      expect(previewed.status, JSON.stringify(previewed.body)).toBe(200);
      expect(previewed.body.message).toBe("Removing 10 credits would leave 3 remaining.");
      expect(previewed.body.data.allocations.map((item: any) => [item.memberMembershipId, item.creditsRemoved])).toEqual([
        [original.id, 3],
        [renewal.id, 5],
        [head.id, 2],
      ]);
      expect([snapshot(head.id), snapshot(original.id), snapshot(renewal.id)]).toEqual(before);
      expect(updateMany.mock.calls.length).toBe(writes);
      expect(await events("admin.membership.remove_pool_credits")).toHaveLength(0);
      expect(await events("credit.admin_removal")).toHaveLength(0);

      const removed = await removePool("GROUP", { credits: 10, expectedRemaining: 13 });
      expect(removed.status).toBe(200);
      expect(removed.body.data).toEqual(previewed.body.data);
    });

    it("refuses with the same codes as the removal", async () => {
      addMembership(groupPlan, { creditsTotal: 5, creditsUsed: 2 });
      const cases: [string, any, any, number, string][] = [
        ["GROUP", { credits: 1, expectedRemaining: 4 }, MEMBER.id, 409, "STALE_BALANCE"],
        ["GROUP", { credits: 4, expectedRemaining: 3 }, MEMBER.id, 400, "INSUFFICIENT_CREDITS"],
        ["PRIVATE", { credits: 1, expectedRemaining: 0 }, MEMBER.id, 409, "MEMBERSHIP_NOT_ACTIVE"],
        ["GROUP", { credits: 1, expectedRemaining: 3 }, "missing", 404, "MEMBER_NOT_FOUND"],
        ["SOLO", { credits: 1, expectedRemaining: 3 }, MEMBER.id, 400, "VALIDATION_ERROR"],
        ["GROUP", { credits: 0, expectedRemaining: 3 }, MEMBER.id, 400, "VALIDATION_ERROR"],
      ];
      for (const [type, body, memberId, status, code] of cases) {
        const [p, r] = [await preview(type, body, ADMIN, memberId), await removePool(type, body, ADMIN, memberId)];
        expect([p.status, p.body.code], JSON.stringify({ type, body })).toEqual([status, code]);
        expect([r.status, r.body.code]).toEqual([status, code]);
      }

      addMembership(unlimitedPlan, { creditsTotal: null });
      expect((await preview("GROUP", { credits: 1, expectedRemaining: 3 })).body.code).toBe("UNLIMITED_MEMBERSHIP");
    });

    it("admin only", async () => {
      addMembership(groupPlan, { creditsTotal: 5, creditsUsed: 0 });
      expect((await preview("GROUP", { credits: 1, expectedRemaining: 5 }, MEMBER)).status).toBe(403);
    });

    // Parity with GET /api/admin/members creditPools is tested against
    // Postgres (the fake has no User -> memberships relation).
  });

  it("leaves the single-record endpoint working beside it", async () => {
    const a = addMembership(groupPlan, { creditsTotal: 5, creditsUsed: 2, expiryDate: utcDay(10) });
    addMembership(groupPlan, { creditsTotal: 5, creditsUsed: 0, expiryDate: utcDay(40) });
    const single = await request(app)
      .post(`/api/admin/members/${MEMBER.id}/memberships/${a.id}/credits/remove`)
      .set(auth(ADMIN))
      .send({ credits: 1, expectedRemaining: 3 });
    expect(single.status, JSON.stringify(single.body)).toBe(200);
    expect(single.body.data).toMatchObject({ memberMembershipId: a.id, creditsRemoved: 1 });

    // The pool reflects it.
    expect((await removePool("GROUP", { credits: 1, expectedRemaining: 7 })).status).toBe(200);
  });
});
