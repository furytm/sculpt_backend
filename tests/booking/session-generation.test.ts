/**
 * Daily class session generation.
 *
 * 1. The scheduler (src/booking/session-generation.scheduler.ts) with
 *    fake timers: it calls the generator every 24 hours, never
 *    overlaps runs, survives failures and stops cleanly.
 * 2. The real ClassSessionService.generateFutureSessions on the
 *    in-memory Prisma fake: repeated runs create no duplicates, and
 *    the window is unchanged (today through today + 29, Lagos).
 *
 * The real unique constraint and the real server startup are checked
 * against PostgreSQL separately (tests/postgres).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePrisma } from "../helpers/fake-prisma";

const fake = createFakePrisma();

vi.mock("../../src/config/prisma.js", () => ({ default: fake.prisma }));

const { scheduleDailySessionGeneration, DAILY_INTERVAL_MS } = await import(
  "../../src/booking/session-generation.scheduler.js"
);
const { default: classSessionService } = await import(
  "../../src/booking/class-session.service.js"
);

const HOUR = 60 * 60 * 1000;

describe("scheduleDailySessionGeneration", () => {
  const logger = { warn: vi.fn(), error: vi.fn() };

  beforeEach(() => {
    vi.useFakeTimers();
    logger.warn.mockClear();
    logger.error.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs every 24 hours, not immediately", async () => {
    expect(DAILY_INTERVAL_MS).toBe(24 * HOUR);
    const generate = vi.fn(async () => undefined);
    const job = scheduleDailySessionGeneration(generate, { logger });

    expect(generate).not.toHaveBeenCalled(); // startup generation is separate

    await vi.advanceTimersByTimeAsync(24 * HOUR - 1);
    expect(generate).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(generate).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(48 * HOUR);
    expect(generate).toHaveBeenCalledTimes(3);

    job.stop();
  });

  it("skips a run while the previous one is still in progress", async () => {
    let finish!: () => void;
    const generate = vi.fn(
      () => new Promise<void>((resolve) => { finish = resolve; })
    );
    const job = scheduleDailySessionGeneration(generate, { logger });

    await vi.advanceTimersByTimeAsync(24 * HOUR); // run 1 starts, never finishes yet
    await vi.advanceTimersByTimeAsync(24 * HOUR); // run 2 is skipped
    await job.run(); // a manual run is skipped too

    expect(generate).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(2);

    finish();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(24 * HOUR); // runs again once free
    expect(generate).toHaveBeenCalledTimes(2);

    job.stop();
  });

  it("logs a failed run without throwing, and keeps running daily", async () => {
    const generate = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValue(undefined);
    const job = scheduleDailySessionGeneration(generate, { logger });

    await vi.advanceTimersByTimeAsync(24 * HOUR);
    expect(logger.error).toHaveBeenCalledWith(
      "❌ Scheduled class session generation failed:",
      expect.objectContaining({ message: "database unavailable" })
    );

    await vi.advanceTimersByTimeAsync(24 * HOUR);
    expect(generate).toHaveBeenCalledTimes(2);

    job.stop();
  });

  it("stop() ends the recurring runs", async () => {
    const generate = vi.fn(async () => undefined);
    const job = scheduleDailySessionGeneration(generate, { logger });

    await vi.advanceTimersByTimeAsync(24 * HOUR);
    job.stop();
    await vi.advanceTimersByTimeAsync(7 * 24 * HOUR);

    expect(generate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("generateFutureSessions (real generator)", () => {
  beforeEach(() => {
    fake.reset();
    vi.useFakeTimers({ toFake: ["Date"] });
    // Wednesday 11 Nov 2026, 10:00 Lagos.
    vi.setSystemTime(new Date("2026-11-11T09:00:00.000Z"));
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    for (const [code, dayOfWeek, startTime] of [
      ["MON-07", "MONDAY", "07:00"],
      ["WED-18", "WEDNESDAY", "18:00"],
      ["SAT-10", "SATURDAY", "10:00"],
    ]) {
      fake.insert("schedule", {
        code,
        className: "Reformer",
        tutorName: "Tutor",
        dayOfWeek,
        startTime,
        endTime: "19:00",
        capacity: 5,
        isActive: true,
      });
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("repeated generation creates no duplicate sessions", async () => {
    const first = await classSessionService.generateFutureSessions();
    const created = fake.tables.classSession.length;

    const second = await classSessionService.generateFutureSessions();
    const third = await classSessionService.generateFutureSessions();

    expect(first.sessionsCreated).toBe(created);
    expect(second).toMatchObject({ sessionsCreated: 0, sessionsExisting: created });
    expect(third).toMatchObject({ sessionsCreated: 0, sessionsExisting: created });
    expect(fake.tables.classSession).toHaveLength(created);

    const keys = fake.tables.classSession.map(
      (row) => `${row.scheduleId}|${row.sessionDate.toISOString()}`
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps the existing window: today through today + 29, at Lagos start times", async () => {
    await classSessionService.generateFutureSessions();

    const dates = fake.tables.classSession
      .map((row) => row.sessionDate.toISOString())
      .sort();

    // Today (Wed 11 Nov) is included, at 18:00 Lagos = 17:00 UTC.
    expect(dates).toContain("2026-11-11T17:00:00.000Z");
    // Last day is today + 29 = Thu 10 Dec; the last generated session
    // falls on or before it, and nothing after.
    expect(dates.at(-1)! <= "2026-12-10T23:59:59.999Z").toBe(true);
    expect(dates.some((iso) => iso >= "2026-12-11")).toBe(false);
    // Mondays at 07:00 Lagos = 06:00 UTC; Saturdays at 10:00 = 09:00 UTC.
    expect(dates).toContain("2026-11-16T06:00:00.000Z");
    expect(dates).toContain("2026-11-14T09:00:00.000Z");
    // 3 schedules, each weekday appears 4-5 times in 30 days.
    expect(dates).toHaveLength(4 + 5 + 4);
  });

  it("a later run moves the window forward and adds only the new days", async () => {
    await classSessionService.generateFutureSessions();
    const before = fake.tables.classSession.length;

    // Two daily runs later (Fri 13 Nov) the window ends on Sat 12 Dec
    // (today + 29), so that Saturday's class is the only new session.
    vi.setSystemTime(new Date("2026-11-13T09:00:00.000Z"));
    const later = await classSessionService.generateFutureSessions();

    expect(later.sessionsCreated).toBe(1);
    expect(fake.tables.classSession).toHaveLength(before + 1);
    expect(
      fake.tables.classSession.map((row) => row.sessionDate.toISOString())
    ).toContain("2026-12-12T09:00:00.000Z");
  });
});
