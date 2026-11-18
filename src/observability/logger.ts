/**
 * Structured console logging: one JSON line per event, with the request
 * and correlation IDs attached and every field sanitized. Never throws.
 */
import { getRequestContext } from "./request-context.js";
import { sanitizeForConsole } from "./sanitize.js";

type Level = "info" | "warn" | "error";

function write(level: Level, event: string, fields?: Record<string, unknown>) {
  try {
    const context = getRequestContext();
    const line = JSON.stringify({
      level,
      time: new Date().toISOString(),
      event,
      requestId: context?.requestId,
      correlationId: context?.correlationId,
      ...(sanitizeForConsole(fields ?? {}) as Record<string, unknown>),
    });
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  } catch {
    // Logging must never affect the operation being logged.
  }
}

export const logger = {
  info: (event: string, fields?: Record<string, unknown>) => write("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => write("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => write("error", event, fields),
};
