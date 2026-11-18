/**
 * When a booking's class starts, for "upcoming" in Health & Safety
 * propagation. sessionDate holds the Lagos calendar date at UTC midnight
 * and startTime is Lagos local time (UTC+1, no daylight saving).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/config/prisma.js", () => ({ default: {} }));

const { sessionStartsAt } = await import("../../src/health-safety/health-safety.service.js");

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("sessionStartsAt (Lagos time)", () => {
  it("converts Lagos local start time to the UTC instant", () => {
    expect(sessionStartsAt(day("2026-11-20"), "10:00").toISOString()).toBe("2026-11-20T09:00:00.000Z");
    expect(sessionStartsAt(day("2026-11-20"), "18:30:00").toISOString()).toBe("2026-11-20T17:30:00.000Z");
    expect(sessionStartsAt(day("2026-11-20"), "2:00 PM").toISOString()).toBe("2026-11-20T13:00:00.000Z");
    expect(sessionStartsAt(day("2026-11-20"), "12:15 AM").toISOString()).toBe("2026-11-19T23:15:00.000Z");
  });

  it("a 00:30 Lagos class has already started at 00:00 UTC that day (not a UTC comparison)", () => {
    const startsAt = sessionStartsAt(day("2026-11-20"), "00:30");
    expect(startsAt.toISOString()).toBe("2026-11-19T23:30:00.000Z");
    expect(startsAt < new Date("2026-11-20T00:00:00.000Z")).toBe(true);
  });

  it("an unreadable start time counts as the end of that Lagos day", () => {
    expect(sessionStartsAt(day("2026-11-20"), "TBC").toISOString()).toBe("2026-11-20T22:59:00.000Z");
    expect(sessionStartsAt(day("2026-11-20"), null).toISOString()).toBe("2026-11-20T22:59:00.000Z");
    expect(sessionStartsAt(day("2026-11-20"), "25:00").toISOString()).toBe("2026-11-20T22:59:00.000Z");
  });
});
