/* eslint-disable @typescript-eslint/no-explicit-any -- decoded JWT claims */
/**
 * Refresh tokens carry a random jti, so two tokens for the same user
 * issued in the same second are different (RefreshToken.token is unique).
 * Login, rotation and revocation over a real database are in
 * tests/postgres/refresh-token.pg.test.ts.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";

process.env.JWT_ACCESS_SECRET = "test-access-secret";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret";

let generateRefreshToken: (payload: any) => string;
let verifyRefreshToken: (token: string) => any;
let generateAccessToken: (payload: any) => string;

beforeAll(async () => {
  ({ generateRefreshToken, verifyRefreshToken, generateAccessToken } = await import("../../src/utils/jwt.js"));
});

afterEach(() => {
  vi.useRealTimers();
});

const payload = { userId: "user_1", email: "ada@example.com", role: "MEMBER" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("refresh token uniqueness", () => {
  it("two tokens for the same user in the same second are different", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-16T10:00:00.000Z"));

    const first = generateRefreshToken(payload);
    const second = generateRefreshToken(payload);

    expect(first).not.toBe(second);
    const [a, b] = [verifyRefreshToken(first), verifyRefreshToken(second)];
    expect(a.iat).toBe(b.iat); // genuinely the same second
    expect(a.jti).not.toBe(b.jti);
  });

  it("many immediate consecutive tokens are all unique", () => {
    const tokens = Array.from({ length: 500 }, () => generateRefreshToken(payload));
    expect(new Set(tokens).size).toBe(500);
  });

  it("keeps the existing claims, expiry and signature check", () => {
    const token = generateRefreshToken(payload);
    const decoded = verifyRefreshToken(token);

    expect(decoded).toMatchObject(payload);
    expect(decoded.jti).toMatch(UUID);
    expect(decoded.exp - decoded.iat).toBe(30 * 24 * 60 * 60);

    // Still signed with the refresh secret only.
    expect(() => jwt.verify(token, "test-access-secret")).toThrow();
    const tampered = token.slice(0, -2) + (token.endsWith("AA") ? "BB" : "AA");
    expect(() => verifyRefreshToken(tampered)).toThrow();
  });

  it("does not change access tokens", () => {
    const decoded = jwt.decode(generateAccessToken(payload)) as any;
    expect(decoded.jti).toBeUndefined();
    expect(decoded.exp - decoded.iat).toBe(15 * 60);
  });
});
