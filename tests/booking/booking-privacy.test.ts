/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed fake rows and HTTP bodies */
/**
 * Booking responses no longer expose Health & Safety notes or account
 * fields (password hash) to people who only know a booking ID or payment
 * reference. Owners and admins still see the full declaration; the
 * declaration summary the checkout pages use is kept for everyone.
 *
 * Real app over HTTP; Prisma is the in-memory fake.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { createFakePrisma } from "../helpers/fake-prisma";

process.env.JWT_ACCESS_SECRET = "test-access-secret";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
process.env.RESEND_API_KEY = "re_test_dummy";
process.env.FRONTEND_URL = "http://localhost:3000";

const fake = createFakePrisma();
vi.mock("../../src/config/prisma.js", () => ({ default: fake.prisma }));

let app: any;
let tokenFor: (user: any) => string;

const OWNER = { id: "owner_1", email: "owner@example.com", role: "MEMBER" };
const OTHER = { id: "other_1", email: "other@example.com", role: "MEMBER" };
const ADMIN = { id: "admin_1", email: "admin@example.com", role: "ADMIN" };
const NOTE = "Recovering from back surgery";

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  app = (await import("../../src/app.js")).default;
  const { generateAccessToken } = await import("../../src/utils/jwt.js");
  tokenFor = (user) => generateAccessToken({ userId: user.id, email: user.email, role: user.role } as any);
}, 60_000);

let booking: any;

beforeEach(() => {
  fake.reset();
  for (const user of [OWNER, OTHER, ADMIN]) {
    fake.insert("user", { ...user, fullName: user.id, phone: "0800", password: "$2a$10$SECRETHASH", provider: "LOCAL" });
  }
  const plan = fake.insert("membership", {
    name: "Monthly", slug: "monthly", type: "GROUP", price: 50000, period: "/month",
    classLimit: 8, duration: "Monthly", isActive: true, features: [],
  });
  booking = fake.insert("booking", {
    fullName: "Owner",
    email: OWNER.email,
    phone: "0800",
    userId: OWNER.id,
    membershipId: plan.id,
    amount: 50000,
    paymentReference: "SL-PRIV-1",
    paymentStatus: "PAID",
    paymentMethod: "PAYMISH",
    bookingStatus: "PENDING",
  });
  fake.insert("healthSafetyForm", {
    bookingId: booking.id,
    userId: OWNER.id,
    accepted: true,
    declarationVersion: "1.0",
    notes: NOTE,
    pregnancy: "no",
    surgeryDetails: "lumbar",
    acceptedAt: new Date("2026-11-10T10:00:00.000Z"),
    submittedAt: new Date("2026-11-10T10:00:00.000Z"),
  });
});

const detail = (headers: Record<string, string> = {}) =>
  request(app).get(`/api/bookings/${booking.id}`).set(headers);
const auth = (user: any) => ({ Authorization: `Bearer ${tokenFor(user)}` });

function expectSummaryOnly(body: any) {
  const text = JSON.stringify(body);
  expect(text).not.toContain(NOTE);
  expect(text).not.toContain("lumbar");
  expect(text).not.toContain("SECRETHASH");
}

describe("GET /api/bookings/:bookingId", () => {
  it("anonymous: summary only (accepted + when), no notes, no password hash", async () => {
    const response = await detail();

    expect(response.status).toBe(200);
    const data = response.body.data;
    expect(data.healthSafetyForm).toEqual({
      id: expect.any(String),
      bookingId: booking.id,
      accepted: true,
      declarationVersion: "1.0",
      acceptedAt: "2026-11-10T10:00:00.000Z",
      submittedAt: "2026-11-10T10:00:00.000Z",
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(data.user).toEqual({ id: OWNER.id, fullName: OWNER.id, email: OWNER.email, phone: "0800", role: "MEMBER" });
    expectSummaryOnly(response.body);
    // Other booking fields are unchanged.
    expect(data).toMatchObject({ id: booking.id, paymentReference: "SL-PRIV-1", bookingStatus: "PENDING" });
  });

  it("another member: summary only", async () => {
    const response = await detail(auth(OTHER));
    expect(response.status).toBe(200);
    expect(response.body.data.healthSafetyForm.notes).toBeUndefined();
    expectSummaryOnly(response.body);
  });

  it("the owner and admins: the full declaration (still never the password hash)", async () => {
    for (const user of [OWNER, ADMIN]) {
      const response = await detail(auth(user));
      expect(response.status).toBe(200);
      expect(response.body.data.healthSafetyForm).toMatchObject({ notes: NOTE, surgeryDetails: "lumbar" });
      expect(JSON.stringify(response.body)).not.toContain("SECRETHASH");
    }
  });

  it("an expired or invalid token is treated as anonymous, not rejected (guest pages keep working)", async () => {
    const expired = jwt.sign({ userId: OWNER.id, email: OWNER.email, role: "MEMBER" }, "test-access-secret", { expiresIn: -10 });
    for (const headers of [{ Authorization: `Bearer ${expired}` }, { Authorization: "Bearer garbage" }, { Cookie: "accessToken=garbage" }]) {
      const response = await detail(headers);
      expect(response.status).toBe(200);
      expectSummaryOnly(response.body);
    }
  });
});

describe("related booking endpoints", () => {
  it("GET /api/bookings/confirmation/:reference (public): summary only", async () => {
    fake.get("booking", booking.id).bookingStatus = "CONFIRMED";
    const response = await request(app).get("/api/bookings/confirmation/SL-PRIV-1");

    expect(response.status).toBe(200);
    expect(response.body.data.booking.healthSafetyForm).toMatchObject({ accepted: true });
    expectSummaryOnly(response.body);
  });

  it("GET /api/bookings/my (owner): full declaration, no password hash", async () => {
    const response = await request(app).get("/api/bookings/my").set(auth(OWNER));

    expect(response.status).toBe(200);
    const [mine] = response.body.data.bookings;
    expect(mine.healthSafetyForm.notes).toBe(NOTE);
    expect(JSON.stringify(response.body)).not.toContain("SECRETHASH");
  });
});
