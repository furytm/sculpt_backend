import crypto from "crypto";

export function generateSecureToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** A uniformly random numeric code, e.g. "042917" (leading zeros kept). */
export function generateNumericCode(digits = 6): string {
  return crypto
    .randomInt(0, 10 ** digits)
    .toString()
    .padStart(digits, "0");
}

export function hashToken(token: string): string {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}