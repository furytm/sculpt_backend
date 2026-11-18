/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed fake rows */
/**
 * Graceful shutdown: stop jobs, stop accepting connections and let
 * active requests finish, flush the activity log (bounded), then
 * disconnect Prisma and exit. Uses the real activity log over the
 * in-memory fake Prisma, and a real HTTP server.
 */
import http from "node:http";
import { AddressInfo } from "node:net";
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createFakePrisma } from "../helpers/fake-prisma";

const fake = createFakePrisma();
vi.mock("../../src/config/prisma.js", () => ({ default: fake.prisma }));

const { createGracefulShutdown } = await import("../../src/lifecycle/graceful-shutdown");
const { activityLog } = await import("../../src/activity-log/activity-log.service");
const { requestContextMiddleware } = await import("../../src/observability/request-context");

beforeEach(() => {
  fake.reset();
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

function fakeDeps(overrides: Record<string, unknown> = {}) {
  const order: string[] = [];
  const deps = {
    server: {
      close: vi.fn((callback: () => void) => {
        order.push("server.close");
        setTimeout(() => {
          order.push("active requests finished");
          callback();
        }, 10);
      }),
    },
    stopJobs: vi.fn(() => order.push("stopJobs")),
    flushActivityLog: vi.fn(async () => {
      order.push("flush");
      return true;
    }),
    disconnect: vi.fn(async () => {
      order.push("disconnect");
    }),
    exit: vi.fn((code: number) => order.push(`exit ${code}`)),
    ...overrides,
  };
  return { deps, order };
}

describe("graceful shutdown", () => {
  it("stops jobs, closes the server, waits for requests, flushes, then disconnects and exits", async () => {
    const { deps, order } = fakeDeps();
    await createGracefulShutdown(deps as any)();

    expect(order).toEqual([
      "stopJobs",
      "server.close",
      "active requests finished",
      "flush",
      "disconnect",
      "exit 0",
    ]);
    expect(deps.flushActivityLog).toHaveBeenCalledWith(5_000);
  });

  it("ignores a second signal", async () => {
    const { deps } = fakeDeps();
    const shutdown = createGracefulShutdown(deps as any);
    await Promise.all([shutdown(), shutdown()]);

    expect(deps.server.close).toHaveBeenCalledTimes(1);
    expect(deps.disconnect).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledTimes(1);
  });

  it("cannot hang on logging: a write that never finishes is abandoned after the timeout", async () => {
    // A write that doesn't finish until released (released at the end, so
    // it can't leak into later tests).
    let releaseWrite!: () => void;
    fake.prisma.memberActivityLog.create.mockImplementationOnce(
      () => new Promise<void>((resolve) => (releaseWrite = resolve))
    );
    activityLog.record({ action: "membership.upgrade", stage: "INITIATED", status: "INFO", userId: "u1" });

    const { deps, order } = fakeDeps({
      flushActivityLog: (timeoutMs: number) => activityLog.flush(timeoutMs),
      flushTimeoutMs: 50,
    });

    const started = Date.now();
    await createGracefulShutdown(deps as any)();

    expect(Date.now() - started).toBeLessThan(1_000);
    expect(order.slice(-2)).toEqual(["disconnect", "exit 0"]);
    const warned = (console.warn as any).mock.calls.map((call: unknown[]) => String(call[0]));
    expect(warned.some((line: string) => line.includes("shutdown.activity_log_flush_timeout"))).toBe(true);

    releaseWrite();
    expect(await activityLog.flush(1_000)).toBe(true);
  });

  it("a failing flush or disconnect still exits", async () => {
    const { deps } = fakeDeps({
      flushActivityLog: async () => {
        throw new Error("flush broke");
      },
      disconnect: async () => {
        throw new Error("disconnect broke");
      },
    });

    await expect(createGracefulShutdown(deps as any)()).rejects.toThrow("disconnect broke");
    expect(deps.exit).toHaveBeenCalledWith(0);
  });

  it("end to end: an active request's buffered events are written before Prisma disconnects", async () => {
    let releaseRequest!: () => void;
    const requestHeld = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    let requestStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      requestStarted = resolve;
    });

    const app = express();
    app.use(requestContextMiddleware);
    app.post("/slow", async (_req, res) => {
      activityLog.record({ action: "membership.upgrade", stage: "INITIATED", status: "INFO", userId: "u1" });
      requestStarted();
      await requestHeld;
      activityLog.record({ action: "membership.upgrade", stage: "PAYMENT_INITIALIZED", status: "INFO", userId: "u1" });
      res.json({ ok: true });
    });

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    // A client without keep-alive (agent: false), like a single browser request.
    const response = new Promise<{ status: number }>((resolve, reject) => {
      const outgoing = http.request(
        { host: "127.0.0.1", port, path: "/slow", method: "POST", agent: false },
        (incoming) => {
          incoming.resume();
          incoming.on("end", () => resolve({ status: incoming.statusCode ?? 0 }));
        }
      );
      outgoing.on("error", reject);
      outgoing.end();
    });
    await started;

    const rowsAtDisconnect: number[] = [];
    const shutdown = createGracefulShutdown({
      server,
      stopJobs: () => undefined,
      flushActivityLog: (timeoutMs) => activityLog.flush(timeoutMs),
      disconnect: async () => {
        rowsAtDisconnect.push(fake.tables.memberActivityLog.length);
      },
      exit: () => undefined,
    });

    const shuttingDown = shutdown();
    // The request is still in progress: nothing written yet.
    expect(fake.tables.memberActivityLog).toHaveLength(0);
    releaseRequest();

    expect((await response).status).toBe(200);
    await shuttingDown;

    expect(rowsAtDisconnect).toEqual([2]);
  });
});
