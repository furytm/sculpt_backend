/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed fake rows */
/**
 * Membership PLAN management security: POST / PATCH / DELETE
 * /api/memberships now require an ADMIN. Public listing is unchanged.
 *
 * The real Express app over HTTP (supertest) with real JWTs from the
 * existing generateAccessToken and the real authenticate / requireAdmin
 * middleware. Only Prisma is the in-memory fake (no database or
 * migrations involved).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createFakePrisma } from "../helpers/fake-prisma";

process.env.JWT_ACCESS_SECRET = "test-access-secret";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
process.env.RESEND_API_KEY = "re_test_dummy"; // the mailer needs a key at import
process.env.FRONTEND_URL = "http://localhost:3000";

const fake = createFakePrisma();

vi.mock("../../src/config/prisma.js", () => ({ default: fake.prisma }));

let app: any;
let token: (role: "ADMIN" | "MEMBER" | "TUTOR") => string;

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  app = (await import("../../src/app.js")).default;
  const { generateAccessToken } = await import("../../src/utils/jwt.js");
  token = (role) =>
    generateAccessToken({ userId: `${role.toLowerCase()}_1`, email: `${role.toLowerCase()}@example.com`, role } as any);
}, 60_000); // loading the whole app (every route and service) takes a while

let plan: any;

beforeEach(() => {
  fake.reset();
  plan = fake.insert("membership", {
    name: "10 Classes/Month",
    slug: "monthly-10",
    type: "GROUP",
    price: 50000,
    period: "/month",
    classLimit: 10,
    duration: "Monthly",
    features: [],
    isActive: true,
    displayOrder: 0,
  });
});

const newPlan = {
  name: "Unlimited Annual",
  slug: "unlimited-annual",
  type: "GROUP",
  price: 900000,
  period: "/year",
  classLimit: null,
  duration: "Annual",
  features: ["Unlimited classes"],
};

const as = (role?: "ADMIN" | "MEMBER" | "TUTOR") =>
  role ? { Authorization: `Bearer ${token(role)}` } : {};

const attempts = (role?: "ADMIN" | "MEMBER" | "TUTOR") => [
  request(app).post("/api/memberships").set(as(role)).send(newPlan),
  request(app).patch(`/api/memberships/${plan.id}`).set(as(role)).send({ price: 1 }),
  request(app).delete(`/api/memberships/${plan.id}`).set(as(role)),
];

const planUnchanged = () => {
  expect(fake.get("membership", plan.id)).toMatchObject({ price: 50000, isActive: true });
  expect(fake.tables.membership).toHaveLength(1);
};

describe("membership plan management", () => {
  it("unauthenticated requests are refused (401) and change nothing", async () => {
    for (const response of await Promise.all(attempts())) {
      expect(response.status).toBe(401);
    }
    planUnchanged();
  });

  it("MEMBER users are refused (403) and change nothing", async () => {
    for (const response of await Promise.all(attempts("MEMBER"))) {
      expect(response.status).toBe(403);
      expect(response.body.message).toBe("Admin access required.");
    }
    planUnchanged();
  });

  it("TUTOR users are refused (403) and change nothing", async () => {
    for (const response of await Promise.all(attempts("TUTOR"))) {
      expect(response.status).toBe(403);
    }
    planUnchanged();
  });

  it("ADMIN users can still create, edit and delete plans", async () => {
    const created = await request(app).post("/api/memberships").set(as("ADMIN")).send(newPlan);
    expect(created.status).toBe(201);
    expect(fake.tables.membership.find((row) => row.slug === "unlimited-annual")).toMatchObject({
      price: 900000,
      isActive: true,
    });

    const updated = await request(app)
      .patch(`/api/memberships/${plan.id}`)
      .set(as("ADMIN"))
      .send({ price: 55000 });
    expect(updated.status).toBe(200);
    expect(fake.get("membership", plan.id).price).toBe(55000);

    const deleted = await request(app).delete(`/api/memberships/${plan.id}`).set(as("ADMIN"));
    expect(deleted.status).toBe(200);
    // The existing soft delete: the plan is deactivated, not removed.
    expect(fake.get("membership", plan.id).isActive).toBe(false);
  });

  it("public plan listing and plan details still work without signing in", async () => {
    const list = await request(app).get("/api/memberships");
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).toContain("10 Classes/Month");

    const one = await request(app).get(`/api/memberships/${plan.id}`);
    expect(one.status).toBe(200);
  });
});
