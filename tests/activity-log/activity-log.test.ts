/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed fake rows */
/**
 * The activity log service against the in-memory fake Prisma: never
 * throws, never blocks, survives a rolled-back business transaction,
 * de-duplicates, attaches request/correlation IDs, and resolves the
 * purchase or booking from a payment reference.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createFakePrisma } from "../helpers/fake-prisma";

const fake = createFakePrisma();
vi.mock("../../src/config/prisma.js", () => ({ default: fake.prisma }));

const { activityLog, resetActivityLogWarningLimiterForTests } = await import(
  "../../src/activity-log/activity-log.service"
);
const { requestContextMiddleware, runWithRequestContext, setCorrelationId } = await import(
  "../../src/observability/request-context"
);

const logs = () => fake.tables.memberActivityLog;

beforeEach(() => {
  fake.reset();
  vi.restoreAllMocks();
  // Each test sees the once-a-minute write-failure warning afresh.
  resetActivityLogWarningLimiterForTests();
});

const writeFailureWarnings = (warn: ReturnType<typeof vi.spyOn>) =>
  warn.mock.calls.filter((call: unknown[]) => String(call[0]).includes("activity_log.write_failed"));

const base = { action: "membership.upgrade", stage: "INITIATED", status: "INFO", actorType: "MEMBER" } as const;

describe("never interrupts the business operation", () => {
  it("record() returns synchronously and does not throw when the database write fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fake.prisma.memberActivityLog.create.mockRejectedValueOnce(new Error("relation does not exist"));

    expect(activityLog.record({ ...base, userId: "u1" })).toBeUndefined();
    await activityLog.flush();

    expect(logs()).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("activity_log.write_failed");
  });

  it("does not throw even when the client itself throws synchronously or the input is hostile", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fake.prisma.memberActivityLog.create.mockImplementationOnce(() => {
      throw new Error("sync failure");
    });
    const hostile: any = { get action() { throw new Error("getter"); } };

    expect(() => activityLog.record({ ...base, userId: "u1" })).not.toThrow();
    expect(() => activityLog.record(hostile)).not.toThrow();
    expect(() => activityLog.record(null as any)).not.toThrow();
    await activityLog.flush();
  });

  // Surviving a rolled-back business transaction needs a real database
  // (separate connections): tests/postgres/activity-log.pg.test.ts.
});

describe("content", () => {
  it("stores allow-listed metadata only and sanitizes free text", async () => {
    activityLog.record({
      ...base,
      userId: "u1",
      errorMessage: "Failed for ada@example.com with Bearer abc123",
      metadata: {
        targetMembershipId: "plan_1",
        amount: 50000,
        password: "hunter2",
        token: "t",
        rawBody: { card: "4111111111111111" },
      },
    });
    await activityLog.flush();

    const [row] = logs();
    expect(row.errorMessage).toBe("Failed for [email] with Bearer [redacted]");
    expect(row.metadata).toEqual({ targetMembershipId: "plan_1", amount: 50000, droppedFields: 3 });
    expect(JSON.stringify(row)).not.toMatch(/hunter2|4111|ada@example/);
  });

  it("keeps subjectEmail only for guests (no account)", async () => {
    activityLog.record({ ...base, actorType: "GUEST", subjectEmail: " Guest@Example.com " });
    activityLog.record({ ...base, userId: "u1", subjectEmail: "member@example.com" });
    await activityLog.flush();

    expect(logs().map((row) => row.subjectEmail)).toEqual(["guest@example.com", null]);
  });

  it("fills the purchase, owner and actor from the payment reference", async () => {
    const purchase = fake.insert("membershipPurchase", {
      paymentReference: "SL-1794821674898-0814c40a",
      email: "Owner@Example.com",
      userId: "u9",
    });
    const guestPurchase = fake.insert("membershipPurchase", {
      paymentReference: "SL-GUEST-1",
      email: "Guest@Example.com",
      userId: null,
    });
    const booking = fake.insert("booking", { paymentReference: "SL-BOOK-1", email: "b@example.com", userId: "u7" });

    for (const reference of ["SL-1794821674898-0814c40a", "SL-GUEST-1", "SL-BOOK-1"]) {
      activityLog.record({ action: "payment.initialize", stage: "PROVIDER_FAILED", status: "FAILURE", paymentReference: reference });
    }
    await activityLog.flush();

    expect(logs()).toEqual([
      expect.objectContaining({
        paymentReference: "SL-1794821674898-0814c40a",
        entityType: "MEMBERSHIP_PURCHASE",
        entityId: purchase.id,
        userId: "u9",
        actorType: "MEMBER",
        subjectEmail: null,
      }),
      expect.objectContaining({ entityId: guestPurchase.id, userId: null, actorType: "GUEST", subjectEmail: "guest@example.com" }),
      expect.objectContaining({ entityType: "BOOKING", entityId: booking.id, userId: "u7" }),
    ]);
  });
});

describe("duplicates", () => {
  it("duplicates are ignored silently: one row per dedupeKey, no warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (let i = 0; i < 3; i += 1) {
      activityLog.record({ ...base, userId: "u1", dedupeKey: "membership.purchase_completion:SL-1" });
    }
    activityLog.record({ ...base, userId: "u1", dedupeKey: "membership.purchase_completion:SL-2" });
    await activityLog.flush();

    expect(logs().map((row) => row.dedupeKey)).toEqual([
      "membership.purchase_completion:SL-1",
      "membership.purchase_completion:SL-2",
    ]);
    // The fake raised real-shaped duplicate errors (meta.target)...
    expect(fake.prisma.memberActivityLog.create).toHaveBeenCalledTimes(4);
    // ...and none was treated as a write failure.
    expect(warn).not.toHaveBeenCalled();
  });

  it("the duplicate check is exact: a unique failure on another field still warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fake.prisma.memberActivityLog.create.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
        meta: { modelName: "MemberActivityLog", target: ["id"] },
      })
    );
    activityLog.record({ ...base, userId: "u1", dedupeKey: "k1" });
    await activityLog.flush();

    expect(logs()).toHaveLength(0);
    expect(writeFailureWarnings(warn)).toHaveLength(1);
  });

  it("write-failure warnings are limited to one a minute", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fake.prisma.memberActivityLog.create.mockRejectedValue(new Error("down"));
    for (let i = 0; i < 5; i += 1) activityLog.record({ ...base, userId: "u1" });
    await activityLog.flush();

    expect(writeFailureWarnings(warn)).toHaveLength(1);
    fake.prisma.memberActivityLog.create.mockReset();
  });

  it("caps events for unknown references at one per action/stage/minute", async () => {
    for (let i = 0; i < 5; i += 1) {
      activityLog.record({ action: "payment.callback", stage: "VERIFICATION_FAILED", status: "FAILURE", paymentReference: `SL-FAKE-${i}` });
    }
    await activityLog.flush();
    expect(logs()).toHaveLength(1);
  });
});

describe("request and correlation IDs", () => {
  it("outside a request: written immediately with the context's IDs", async () => {
    await runWithRequestContext(async () => {
      setCorrelationId("SL-JOB-1");
      activityLog.record({ ...base, userId: "u1" });
    }, { requestId: "job-1" });
    await activityLog.flush();

    expect(logs()[0]).toMatchObject({ requestId: "job-1", correlationId: "SL-JOB-1" });
  });

  it("inside a request: written after the response, with the FINAL correlation ID", async () => {
    const app = express();
    app.use(requestContextMiddleware);
    app.post("/flow", async (_req, res) => {
      activityLog.record({ ...base, userId: "u1" }); // before the reference is known
      await Promise.resolve();
      setCorrelationId("SL-777-abc"); // e.g. payment initialization
      activityLog.record({ ...base, stage: "PAYMENT_INITIALIZED", userId: "u1", paymentReference: "SL-777-abc" });
      expect(logs()).toHaveLength(0); // nothing written while the request runs
      res.json({ ok: true });
    });

    const response = await request(app).post("/flow");
    await activityLog.flush();

    expect(response.body).toEqual({ ok: true });
    expect(logs()).toHaveLength(2);
    for (const row of logs()) {
      expect(row.requestId).toBe(response.headers["x-request-id"]);
      expect(row.correlationId).toBe("SL-777-abc");
    }
  });

  it("concurrent requests with different correlation IDs never share them", async () => {
    const app = express();
    app.use(requestContextMiddleware);
    app.post("/pay/:reference", async (req, res) => {
      const pause = () => new Promise((resolve) => setTimeout(resolve, Math.random() * 15));
      activityLog.record({ ...base, userId: "u1" });
      await pause();
      setCorrelationId(String(req.params.reference));
      await pause();
      activityLog.record({ ...base, stage: "PAYMENT_INITIALIZED", userId: "u1" });
      await pause();
      res.json({ ok: true });
    });

    const references = Array.from({ length: 12 }, (_, i) => `SL-CONC-${i}`);
    const responses = await Promise.all(
      references.map((reference) => request(app).post(`/pay/${reference}`))
    );
    await activityLog.flush();

    expect(logs()).toHaveLength(24);
    responses.forEach((response, i) => {
      const rows = logs().filter((row) => row.requestId === response.headers["x-request-id"]);
      expect(rows).toHaveLength(2);
      for (const row of rows) expect(row.correlationId).toBe(references[i]);
    });
  });

  it("an explicit correlationId on the event wins", async () => {
    await runWithRequestContext(async () => {
      setCorrelationId("SL-CTX");
      activityLog.record({ ...base, userId: "u1", correlationId: "SL-OWN" });
    });
    await activityLog.flush();
    expect(logs()[0].correlationId).toBe("SL-OWN");
  });
});
