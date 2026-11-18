/**
 * One place that decides what an error means for the HTTP response and
 * for the logs.
 *
 * Backward compatible: a plain `new Error("…")` is how the services
 * report business-rule failures ("You do not have any remaining class
 * credits."), so it keeps its message and the caller's existing status
 * (normally 400). Only errors that are NOT business messages change:
 *
 * - Paymish failures: 502 and a generic message (no provider response);
 * - database errors, programming errors and non-Error throws: 500 and a
 *   generic message, instead of the raw internal text.
 */
import axios from "axios";
import { Response } from "express";
import { PaymentProviderError } from "../payment/payment-provider.error.js";
import { getRequestId } from "./request-context.js";
import { sanitizeText } from "./sanitize.js";

export const INTERNAL_ERROR_MESSAGE = "Something went wrong. Please try again.";

export type ErrorKind = "business" | "provider" | "database" | "internal" | "request";

export interface ErrorDescription {
  kind: ErrorKind;
  httpStatus: number;
  /** Stable code for logs and clients, e.g. PAYMENT_PROVIDER_ERROR, DATABASE_ERROR. */
  code: string;
  /** Safe to send to the browser. */
  publicMessage: string;
  /** Safe to store in logs (sanitized, truncated). */
  logMessage: string;
  /** Extra safe fields for logs. */
  logFields: Record<string, string | number | boolean | null>;
  /**
   * Sanitized stack trace, one entry per line, for unexpected internal
   * and database errors only. For SERVER LOGS ONLY: never sent to the
   * browser and never stored in the activity log.
   */
  logStack?: string[];
}

const MAX_STACK_LINES = 20;

/**
 * A sanitized stack for server logs. For database errors the message
 * lines are dropped (Prisma puts query arguments there); only the
 * error name and the "at …" frames are kept.
 */
export function sanitizedStack(error: unknown, includeMessage: boolean): string[] | undefined {
  try {
    if (!(error instanceof Error) || typeof error.stack !== "string") return undefined;

    const lines = error.stack.split("\n").map((line) => line.trim()).filter(Boolean);
    const frames = lines.filter((line) => line.startsWith("at "));
    const head = includeMessage
      ? sanitizeText(`${error.name}: ${error.message}`, 300)
      : error.name;

    return [head, ...frames.map((frame) => sanitizeText(frame, 300))].slice(0, MAX_STACK_LINES);
  } catch {
    return undefined;
  }
}

const PRISMA_ERROR_NAMES = new Set([
  "PrismaClientKnownRequestError",
  "PrismaClientUnknownRequestError",
  "PrismaClientRustPanicError",
  "PrismaClientInitializationError",
  "PrismaClientValidationError",
]);

function isPrismaError(error: unknown): error is Error & { code?: string; meta?: unknown } {
  return error instanceof Error && PRISMA_ERROR_NAMES.has(error.name);
}

/**
 * @param businessStatus the status this caller already used for business
 * errors (kept unchanged; usually 400).
 */
export function describeError(error: unknown, businessStatus = 400): ErrorDescription {
  try {
    if (error instanceof PaymentProviderError) {
      return {
        kind: "provider",
        httpStatus: 502,
        code: error.code,
        publicMessage: error.message,
        logMessage: sanitizeText(
          `Paymish ${error.operation} failed${
            error.providerHttpStatus ? ` (HTTP ${error.providerHttpStatus})` : " (unreachable)"
          }${error.providerMessage ? `: ${error.providerMessage}` : ""}`
        ),
        logFields: error.toLogFields(),
      };
    }

    if (isPrismaError(error)) {
      const target = (error.meta as { target?: unknown; modelName?: unknown } | undefined) ?? {};
      return {
        kind: "database",
        httpStatus: 500,
        code: "DATABASE_ERROR",
        publicMessage: INTERNAL_ERROR_MESSAGE,
        // Never the Prisma message itself: it holds file paths and query arguments.
        logMessage: sanitizeText(
          `${error.name}${error.code ? ` ${error.code}` : ""}${
            target.modelName ? ` on ${String(target.modelName)}` : ""
          }${target.target ? ` (${String(target.target)})` : ""}`
        ),
        logFields: { prismaCode: error.code ?? null },
        logStack: sanitizedStack(error, false),
      };
    }

    // Body-parser and similar request errors carry their own 4xx status.
    const status = (error as { status?: unknown; statusCode?: unknown } | null)?.status ??
      (error as { statusCode?: unknown } | null)?.statusCode;
    if (error instanceof Error && typeof status === "number" && status >= 400 && status < 500) {
      const isJson = (error as { type?: unknown }).type === "entity.parse.failed";
      return {
        kind: "request",
        httpStatus: status,
        code: isJson ? "INVALID_JSON" : "BAD_REQUEST",
        publicMessage: isJson ? "The request body is not valid JSON." : "The request could not be processed.",
        logMessage: sanitizeText(`${error.name}: ${(error as { type?: unknown }).type ?? error.message}`),
        logFields: {},
      };
    }

    // An HTTP client failure (not a normalized Paymish failure) is never
    // a business message, whatever its prototype.
    if (axios.isAxiosError(error)) {
      return {
        kind: "internal",
        httpStatus: 500,
        code: "INTERNAL_ERROR",
        publicMessage: INTERNAL_ERROR_MESSAGE,
        logMessage: sanitizeText(`${error.name}${error.code ? ` ${error.code}` : ""}: ${error.message}`),
        logFields: {},
        logStack: sanitizedStack(error, true),
      };
    }

    // A plain Error is a service's business-rule message: unchanged.
    if (error instanceof Error && Object.getPrototypeOf(error) === Error.prototype) {
      return {
        kind: "business",
        httpStatus: businessStatus,
        code: "REQUEST_REJECTED",
        publicMessage: error.message,
        logMessage: sanitizeText(error.message),
        logFields: {},
      };
    }

    // Named domain errors (subclasses with their own messages, e.g.
    // PaidFailedPurchaseError) are business errors too, unless they are
    // programming errors or another HTTP client's failure.
    if (
      error instanceof Error &&
      !axios.isAxiosError(error) &&
      !(error instanceof TypeError) &&
      !(error instanceof ReferenceError) &&
      !(error instanceof RangeError) &&
      !(error instanceof SyntaxError)
    ) {
      return {
        kind: "business",
        httpStatus: businessStatus,
        code: "REQUEST_REJECTED",
        publicMessage: error.message,
        logMessage: sanitizeText(`${error.name}: ${error.message}`),
        logFields: {},
      };
    }

    return {
      kind: "internal",
      httpStatus: 500,
      code: "INTERNAL_ERROR",
      publicMessage: INTERNAL_ERROR_MESSAGE,
      logMessage: sanitizeText(
        error instanceof Error ? `${error.name}: ${error.message}` : `Non-error thrown: ${typeof error}`
      ),
      logFields: {},
      logStack: sanitizedStack(error, true),
    };
  } catch {
    return {
      kind: "internal",
      httpStatus: 500,
      code: "INTERNAL_ERROR",
      publicMessage: INTERNAL_ERROR_MESSAGE,
      logMessage: "Unclassifiable error",
      logFields: {},
    };
  }
}

/**
 * Sends a failure response in the caller's existing JSON shape, adding
 * `requestId` (and `code` for non-business errors). `body` holds the
 * caller's existing fields, e.g. { success: false }.
 */
export function sendErrorResponse(
  res: Response,
  description: ErrorDescription,
  body: Record<string, unknown> = {},
  /** The caller's existing fallback text for an empty business message. */
  fallbackMessage = INTERNAL_ERROR_MESSAGE
) {
  return res.status(description.httpStatus).json({
    ...body,
    message: description.publicMessage || fallbackMessage,
    ...(description.kind !== "business" && { code: description.code }),
    requestId: getRequestId(),
  });
}
