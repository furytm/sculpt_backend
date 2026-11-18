/**
 * Keeps secrets and personal data out of logs.
 *
 * Nothing here throws: every function accepts any input and returns a
 * safe value.
 */

/** Keys whose values are never logged, whatever the caller allow-lists. */
export const SENSITIVE_KEY =
  /pass(word)?|passcode|otp|token|secret|authori[sz]ation|cookie|card|cvv|cvc|\bpan\b|\bpin\b|signature|bearer|api[-_]?key|private[-_]?key|^code$|verification[-_]?code/i;

export const MAX_MESSAGE_LENGTH = 500;
export const MAX_VALUE_LENGTH = 200;

/** "+" then 8-15 digits, allowing spaces, dots, dashes and brackets: +234 803 123 4567, +44 20 7946 0958, +1 (415) 555-0132. */
const PHONE_INTERNATIONAL = /(?<![\w+])\+\d(?:[\s().-]{0,2}\d){7,14}(?!\d)/g;
/** Nigerian mobile with the country code but no "+": 2348031234567. */
const PHONE_NIGERIA_INTL = /\b234[789][01]\d{8}\b/g;
/** Nigerian mobile, local: 08031234567, 0803 123 4567, 0803-123-4567. */
const PHONE_NIGERIA_LOCAL = /\b0[789][01]\d(?:[\s-]?\d){7}\b/g;
/** UK mobile, local: 07911 123456, 07911123456. */
const PHONE_UK_MOBILE = /\b07\d{3}[\s-]?\d{6}\b/g;
/** US/Canada: (415) 555-0132, 415-555-0132, 415.555.0132. */
const PHONE_US = /(?:\(\d{3}\)\s?|\b\d{3}[.-])\d{3}[.-]\d{4}\b/g;

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = Number(digits[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Removes emails, tokens, keys and card-like numbers from free text, and truncates it. */
export function sanitizeText(value: unknown, maxLength = MAX_MESSAGE_LENGTH): string {
  try {
    let text = typeof value === "string" ? value : String(value ?? "");

    text = text
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
      .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[token]")
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
      .replace(/\b(?:sk|pk|re|whsec)_[A-Za-z0-9_]{8,}\b/g, "[key]")
      .replace(/\b[a-f0-9]{32,}\b/gi, "[redacted]")
      // Card-like numbers: 15-19 digits in a row, or 4-digit groups.
      // (13-digit runs are left alone: payment references contain
      // 13-digit timestamps, e.g. SL-1794821674898-0814c40a.)
      .replace(/\b(?:\d{15,19}|(?:\d{4}[ -]){3}\d{3,7})\b/g, (match) =>
        luhnValid(match.replace(/\D/g, "")) ? "[number]" : match
      )
      // Phone numbers. Each pattern needs a phone-shaped prefix, so
      // payment references (SL-1794821674898-…), timestamps, amounts and
      // IDs are left alone.
      .replace(PHONE_INTERNATIONAL, "[phone]")
      .replace(PHONE_NIGERIA_INTL, "[phone]")
      .replace(PHONE_NIGERIA_LOCAL, "[phone]")
      .replace(PHONE_UK_MOBILE, "[phone]")
      .replace(PHONE_US, "[phone]")
      .replace(/\s+/g, " ")
      .trim();

    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
  } catch {
    return "";
  }
}

/**
 * For identifiers we generate (payment references, IDs, correlation
 * keys): keeps them exact, only removing characters they never contain.
 */
export function sanitizeIdentifier(value: unknown, maxLength = 200): string | null {
  try {
    if (value === null || value === undefined) return null;
    const text = String(value).replace(/[^A-Za-z0-9._:@+-]/g, "").slice(0, maxLength);
    return text || null;
  } catch {
    return null;
  }
}

export type SafeValue = string | number | boolean | null;

/**
 * Keeps only allow-listed keys with primitive values. Sensitive key
 * names are masked even when allow-listed; nested objects, arrays and
 * functions are dropped.
 */
export function sanitizeMetadata(
  metadata: unknown,
  allowedKeys: ReadonlySet<string>
): Record<string, SafeValue> | undefined {
  try {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      return undefined;
    }

    const output: Record<string, SafeValue> = {};
    let dropped = 0;

    for (const [key, value] of Object.entries(metadata as Record<string, unknown>)) {
      if (!allowedKeys.has(key)) {
        dropped += 1;
        continue;
      }
      if (SENSITIVE_KEY.test(key)) {
        output[key] = "[redacted]";
        continue;
      }
      if (value === null || typeof value === "boolean") {
        output[key] = value;
      } else if (typeof value === "number") {
        output[key] = Number.isFinite(value) ? value : null;
      } else if (typeof value === "string") {
        output[key] = sanitizeText(value, MAX_VALUE_LENGTH);
      } else if (value instanceof Date) {
        output[key] = Number.isNaN(value.getTime()) ? null : value.toISOString();
      } else {
        dropped += 1;
      }
    }

    if (dropped > 0) output.droppedFields = dropped;
    return Object.keys(output).length ? output : undefined;
  } catch {
    return undefined;
  }
}

/** For console logs: masks sensitive keys at any depth and sanitizes strings. */
export function sanitizeForConsole(value: unknown, depth = 0): unknown {
  try {
    if (value === null || value === undefined) return value;
    if (typeof value === "string") return sanitizeText(value);
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (value instanceof Date) return value.toISOString();
    if (depth > 3) return "[nested]";
    if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeForConsole(item, depth + 1));
    if (typeof value === "object") {
      const output: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        output[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : sanitizeForConsole(item, depth + 1);
      }
      return output;
    }
    return undefined;
  } catch {
    return "[unloggable]";
  }
}
