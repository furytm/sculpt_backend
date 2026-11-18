/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed error and request stubs */
/**
 * Request context, sanitization, error classification, Paymish error
 * normalization and the final error handler.
 */
import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { AxiosError, AxiosHeaders } from "axios";
import { Prisma } from "@prisma/client";
import {
  getRequestContext,
  getRequestId,
  requestContextMiddleware,
  runWithRequestContext,
  setCorrelationId,
} from "../../src/observability/request-context";
import { sanitizeForConsole, sanitizeIdentifier, sanitizeMetadata, sanitizeText } from "../../src/observability/sanitize";
import { describeError, INTERNAL_ERROR_MESSAGE } from "../../src/observability/errors";
import { errorHandler } from "../../src/observability/error-handler";
import {
  isPaymentProviderFailure,
  PAYMENT_PROVIDER_PUBLIC_MESSAGE,
  PaymentProviderError,
  toPaymentProviderError,
} from "../../src/payment/payment-provider.error";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function axiosError(status: number | undefined, data: unknown) {
  const config = { headers: new AxiosHeaders() } as any;
  return new AxiosError(
    "Request failed",
    status ? "ERR_BAD_RESPONSE" : "ECONNREFUSED",
    config,
    // A request object only when one was sent and answered; callers add
    // one for "sent but unanswered".
    status ? {} : undefined,
    status ? ({ status, data, statusText: "", headers: {}, config } as any) : undefined
  );
}

describe("request IDs", () => {
  const app = express();
  app.use(requestContextMiddleware);
  app.get("/id", async (_req, res) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    await Promise.resolve();
    res.json({ requestId: getRequestId(), correlationId: getRequestContext()?.correlationId ?? null });
  });
  app.get("/correlate", async (_req, res) => {
    setCorrelationId("SL-123-abc");
    await new Promise((resolve) => setTimeout(resolve, 1));
    res.json({ correlationId: getRequestContext()?.correlationId });
  });

  it("gives every request a new UUID, in the header and through async work", async () => {
    const [a, b] = await Promise.all([request(app).get("/id"), request(app).get("/id")]);
    expect(a.body.requestId).toMatch(UUID);
    expect(a.headers["x-request-id"]).toBe(a.body.requestId);
    expect(b.body.requestId).not.toBe(a.body.requestId);
  });

  it("never takes the request ID or correlation ID from the client", async () => {
    const response = await request(app)
      .get("/id")
      .set("X-Request-Id", "attacker-chosen")
      .set("X-Correlation-Id", "attacker-chosen");
    expect(response.body.requestId).not.toBe("attacker-chosen");
    expect(response.body.correlationId).toBeNull();
  });

  it("lets backend code set the correlation ID for the rest of the request", async () => {
    const response = await request(app).get("/correlate");
    expect(response.body.correlationId).toBe("SL-123-abc");
  });

  it("is isolated between concurrent contexts", async () => {
    const seen = await Promise.all(
      ["a", "b", "c"].map((id) =>
        runWithRequestContext(async () => {
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
          return getRequestId();
        }, { requestId: id })
      )
    );
    expect(seen).toEqual(["a", "b", "c"]);
    expect(getRequestId()).toBeUndefined();
  });
});

describe("sanitization", () => {
  it("removes emails, bearer tokens, JWTs, keys, hashes and card numbers from text", () => {
    const text = sanitizeText(
      "user ada@example.com sent Bearer abc.def.ghi with eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig and sk_live_abcdefgh123 " +
        "hash 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 card 4111 1111 1111 1111 and 4242424242424242"
    );
    expect(text).not.toMatch(/ada@example\.com|abc\.def|eyJ|sk_live|9f86d081|4111|4242/);
    expect(text).toContain("[email]");
    expect(text).toContain("[number]");
  });

  it("keeps payment references and timestamps intact", () => {
    for (const reference of ["SL-1794821674898-0814c40a", "OFFLINE-1794821674898-abcd1234", "SL-UPGRADE-1794700860000"]) {
      expect(sanitizeText(`ref ${reference}`)).toBe(`ref ${reference}`);
      expect(sanitizeIdentifier(reference)).toBe(reference);
    }
  });

  it("truncates long text", () => {
    const text = sanitizeText("x".repeat(2000));
    expect(text.length).toBeLessThanOrEqual(500);
  });

  it("metadata: only allow-listed primitive fields; sensitive names masked even if allowed", () => {
    const allowed = new Set(["amount", "password", "note", "nested", "when"]);
    const result = sanitizeMetadata(
      {
        amount: 5000,
        password: "hunter2",
        note: "contact ada@example.com",
        nested: { token: "x" },
        when: new Date("2026-11-17T00:00:00.000Z"),
        authorization: "Bearer x",
        cardNumber: "4111111111111111",
        otp: "123456",
      },
      allowed
    );
    expect(result).toEqual({
      amount: 5000,
      password: "[redacted]",
      note: "contact [email]",
      when: "2026-11-17T00:00:00.000Z",
      droppedFields: 4, // nested, authorization, cardNumber, otp
    });
  });

  it("console sanitizer masks secrets at any depth and never throws", () => {
    const circular: any = { token: "secret", inner: { cookie: "c", ok: "fine" } };
    circular.self = circular;
    const result: any = sanitizeForConsole(circular);
    expect(result.token).toBe("[redacted]");
    expect(result.inner).toEqual({ cookie: "[redacted]", ok: "fine" });
    expect(() => sanitizeForConsole({ get boom() { throw new Error("x"); } })).not.toThrow();
  });
});

describe("Paymish error normalization", () => {
  it("keeps only safe fields from a provider error response", () => {
    const error = toPaymentProviderError(
      axiosError(422, {
        status: "error",
        message: "Invalid amount for customer ada@example.com",
        customer: { email: "ada@example.com", phone: "0801" },
        authorization: "Bearer sk_live_secret",
      }),
      "initialize",
      "SL-1-ab"
    );

    expect(error).toBeInstanceOf(PaymentProviderError);
    expect(error.message).toBe(PAYMENT_PROVIDER_PUBLIC_MESSAGE);
    expect(error.code).toBe("PAYMENT_PROVIDER_ERROR");
    expect(error.toLogFields()).toEqual({
      operation: "initialize",
      providerHttpStatus: 422,
      providerCode: "error",
      providerMessage: "Invalid amount for customer [email]",
    });
    expect(JSON.stringify(error)).not.toMatch(/ada@example|0801|sk_live/);
  });

  it("classifies an unreachable provider separately", () => {
    const error = toPaymentProviderError(axiosError(undefined, undefined), "verify", "SL-1-ab");
    expect(error.code).toBe("PAYMENT_PROVIDER_UNAVAILABLE");
    expect(error.providerHttpStatus).toBeUndefined();
  });

  it("is a 502 with a generic message for API callers", () => {
    const description = describeError(toPaymentProviderError(axiosError(500, { message: "Internal" }), "initialize"));
    expect(description).toMatchObject({ kind: "provider", httpStatus: 502, publicMessage: PAYMENT_PROVIDER_PUBLIC_MESSAGE });
    expect(description.logMessage).toBe("Paymish initialize failed (HTTP 500): Internal");
  });
});

describe("error classification", () => {
  it("keeps business-rule messages and the caller's status", () => {
    expect(describeError(new Error("You are already on this membership."))).toMatchObject({
      kind: "business",
      httpStatus: 400,
      publicMessage: "You are already on this membership.",
    });
  });

  it("hides database errors behind a generic 500", () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError(
      "Invalid `prisma.refreshToken.create()` invocation in C:\\server\\auth.service.ts:538:29 Unique constraint failed",
      { code: "P2002", clientVersion: "6", meta: { modelName: "RefreshToken", target: ["token"] } }
    );
    const description = describeError(prismaError);
    expect(description).toMatchObject({
      kind: "database",
      httpStatus: 500,
      code: "DATABASE_ERROR",
      publicMessage: INTERNAL_ERROR_MESSAGE,
    });
    expect(description.logMessage).toBe("PrismaClientKnownRequestError P2002 on RefreshToken (token)");
    expect(description.logMessage).not.toContain("auth.service.ts");
  });

  it("treats programming errors and non-Error throws as internal 500s", () => {
    expect(describeError(new TypeError("Cannot read properties of undefined"))).toMatchObject({ kind: "internal", httpStatus: 500 });
    expect(describeError({ status: "error", data: "raw" })).toMatchObject({ kind: "internal", httpStatus: 500 });
    expect(describeError("boom")).toMatchObject({ kind: "internal", publicMessage: INTERNAL_ERROR_MESSAGE });
  });
});

describe("final error handler", () => {
  const app = express();
  app.use(requestContextMiddleware);
  app.use(express.json());
  app.post("/echo", (req, res) => res.json(req.body));
  app.get("/throws", () => {
    throw new Prisma.PrismaClientKnownRequestError("secret internals at C:\\x.ts", { code: "P1001", clientVersion: "6" });
  });
  app.get("/rejects", async () => {
    throw new Error("unhandled business text with ada@example.com");
  });
  app.use(errorHandler);

  it("answers malformed JSON with JSON 400 and the request ID", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await request(app).post("/echo").set("Content-Type", "application/json").send("{bad json");
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      message: "The request body is not valid JSON.",
      code: "INVALID_JSON",
      requestId: response.headers["x-request-id"],
    });
  });

  it("answers unexpected errors with a generic 500, never the internal text", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const path of ["/throws", "/rejects"]) {
      const response = await request(app).get(path);
      expect(response.status).toBe(500);
      expect(response.body.message).toBe(INTERNAL_ERROR_MESSAGE);
      expect(response.body.requestId).toBe(response.headers["x-request-id"]);
      expect(JSON.stringify(response.body)).not.toMatch(/internals|ada@example|x\.ts/);
    }
  });

  it("does not affect normal requests", async () => {
    const response = await request(app).post("/echo").send({ a: 1 });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ a: 1 });
  });
});

describe("phone-number masking", () => {
  it.each([
    "08031234567",
    "0803 123 4567",
    "0803-123-4567",
    "07012345678",
    "09098765432",
    "2348031234567",
    "+2348031234567",
    "+234 803 123 4567",
    "+234-803-123-4567",
    "+44 20 7946 0958",
    "+44 7911 123456",
    "07911 123456",
    "+1 (415) 555-0132",
    "(415) 555-0132",
    "415-555-0132",
    "+33 1 42 68 53 00",
  ])("masks %s inside provider text", (phone) => {
    const text = sanitizeText(`Customer phone ${phone} is invalid`);
    expect(text).toBe("Customer phone [phone] is invalid");
  });

  it.each([
    "SL-1794821674898-0814c40a",
    "OFFLINE-1794821674898-abcd1234",
    "SL-UPGRADE-1794700860000",
    "booking cmvy9qsbl002hop332otkl3hd",
    "amount 150000",
    "amount ₦150,000.00",
    "amount 90000 kobo",
    "timestamp 1794821674898",
    "HTTP 422",
    "2026-11-17T13:38:06.746Z",
    "request 12777887-5bc3-46dd-8652-92137011cb52",
    "classes 8 of 10",
  ])("leaves %s unchanged", (value) => {
    expect(sanitizeText(value)).toBe(value);
  });
});

describe("server-side stack traces", () => {
  it("internal errors carry a sanitized stack for server logs", () => {
    const error = new TypeError("Cannot read properties of undefined (reading 'data') for ada@example.com");
    const description = describeError(error);

    expect(description.logStack?.[0]).toBe(
      "TypeError: Cannot read properties of undefined (reading 'data') for [email]"
    );
    expect(description.logStack!.slice(1).every((line) => line.startsWith("at "))).toBe(true);
    expect(description.logStack!.length).toBeGreaterThan(1);
    expect(description.logStack!.length).toBeLessThanOrEqual(20);
    // The browser still gets only the generic message.
    expect(description.publicMessage).toBe(INTERNAL_ERROR_MESSAGE);
  });

  it("database errors keep frames but drop the message (Prisma puts query arguments there)", () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError(
      "Invalid `prisma.user.update()` invocation: data { email: \"ada@example.com\", phone: \"08031234567\" }",
      { code: "P2002", clientVersion: "6" }
    );
    const stack = describeError(prismaError).logStack!;

    expect(stack[0]).toBe("PrismaClientKnownRequestError");
    expect(stack.join("\n")).not.toMatch(/invocation|ada@example|08031234567/);
  });

  it("business and provider errors carry no stack", () => {
    expect(describeError(new Error("You are already on this membership.")).logStack).toBeUndefined();
    expect(describeError(toPaymentProviderError(axiosError(500, {}), "initialize")).logStack).toBeUndefined();
  });

  it("the final error handler logs the stack but never returns it", async () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: unknown) => {
      errors.push(String(line));
    });
    const app = express();
    app.use(requestContextMiddleware);
    app.get("/bug", () => {
      throw new TypeError("boom");
    });
    app.use(errorHandler);

    const response = await request(app).get("/bug");

    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toMatch(/at |stack|boom/);
    const logged = JSON.parse(errors.find((line) => line.includes("http.unhandled_error"))!);
    expect(logged.stack[0]).toBe("TypeError: boom");
    expect(logged.stack.length).toBeGreaterThan(1);
  });
});

describe("provider failures versus internal errors", () => {
  it("only answered or sent-but-unanswered Paymish calls are provider failures", () => {
    const answered = axiosError(500, { message: "x" });
    const unanswered = Object.assign(axiosError(undefined, undefined), { request: {} });
    const configError = axiosError(undefined, undefined); // e.g. no base URL: never sent

    expect(isPaymentProviderFailure(answered)).toBe(true);
    expect(isPaymentProviderFailure(unanswered)).toBe(true);
    expect(isPaymentProviderFailure(configError)).toBe(false);
    expect(isPaymentProviderFailure(new TypeError("bug"))).toBe(false);
    expect(isPaymentProviderFailure(new Error("bad data"))).toBe(false);
    expect(isPaymentProviderFailure("string")).toBe(false);
  });
});
