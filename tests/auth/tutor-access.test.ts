/* eslint-disable @typescript-eslint/no-explicit-any -- minimal Express request/response stubs */
/**
 * The TUTOR route allow-list (src/middleware/tutorAccess.ts). The real
 * routes, middleware and database are exercised over HTTP in
 * tests/postgres/tutor-access.pg.test.ts.
 */
import { describe, expect, it, vi } from "vitest";
import {
  isTutorRouteAllowed,
  rejectTutorOutsideAllowedRoutes,
} from "../../src/middleware/tutorAccess";

const req = (method: string, originalUrl: string, role?: string) =>
  ({ method, originalUrl, user: role ? { role } : undefined }) as any;

const res = () => {
  const response: any = {};
  response.status = vi.fn(() => response);
  response.json = vi.fn(() => response);
  return response;
};

describe("tutor route allow-list", () => {
  it("allows only the tutor schedule (GET) and the signed-in account", () => {
    expect(isTutorRouteAllowed(req("GET", "/api/admin/tutor-schedule?startDate=2026-11-01&endDate=2026-11-30"))).toBe(true);
    expect(isTutorRouteAllowed(req("GET", "/api/admin/tutor-schedule/"))).toBe(true);
    expect(isTutorRouteAllowed(req("GET", "/API/Admin/Tutor-Schedule"))).toBe(true);
    expect(isTutorRouteAllowed(req("GET", "/api/auth/me"))).toBe(true);
  });

  it("refuses everything else, including other methods on allowed paths", () => {
    for (const [method, url] of [
      ["POST", "/api/admin/tutor-schedule"],
      ["DELETE", "/api/admin/tutor-schedule"],
      ["GET", "/api/admin/tutor-schedule/extra"],
      ["GET", "/api/admin/dashboard"],
      ["POST", "/api/bookings/member-session"],
      ["POST", "/api/memberships/purchase"],
      ["POST", "/api/payments/initialize"],
      ["PATCH", "/api/auth/profile"],
    ]) {
      expect(isTutorRouteAllowed(req(method, url))).toBe(false);
    }
  });

  it("never affects ADMIN or MEMBER requests", () => {
    for (const role of ["ADMIN", "MEMBER"]) {
      const response = res();
      expect(rejectTutorOutsideAllowedRoutes(req("GET", "/api/admin/dashboard", role), response)).toBe(false);
      expect(response.status).not.toHaveBeenCalled();
    }
  });

  it("answers a TUTOR outside the allow-list with 403", () => {
    const response = res();
    expect(rejectTutorOutsideAllowedRoutes(req("GET", "/api/admin/dashboard", "TUTOR"), response)).toBe(true);
    expect(response.status).toHaveBeenCalledWith(403);
  });
});
