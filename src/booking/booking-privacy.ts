/**
 * What booking responses may reveal, by viewer.
 *
 * - The related `user` is reduced to id/name/email/phone/role for
 *   everyone (never the password hash or other account fields).
 * - The Health & Safety form is returned in full only to the booking's
 *   owner and to admins. Anyone else (e.g. a guest who only has the
 *   booking ID or payment reference) gets a summary: whether a
 *   declaration was accepted and when, without notes or health details.
 *   That summary is what the checkout and confirmation pages use.
 */
import { Request } from "express";
import { verifyAccessToken } from "../utils/jwt.js";
import { JwtPayload } from "../auth/auth.types.js";

export interface Viewer {
  userId: string;
  role: string;
}

/**
 * The signed-in viewer, if any, WITHOUT rejecting the request: a missing,
 * invalid or expired token simply means "not signed in", so public
 * booking pages keep working exactly as before.
 */
export function viewerFromRequest(req: Request): Viewer | null {
  try {
    if (req.user) return { userId: req.user.userId, role: req.user.role };
    const token =
      req.cookies?.accessToken ||
      req.headers.authorization?.replace(/^Bearer\s+/, "");
    if (!token) return null;
    const payload: JwtPayload = verifyAccessToken(token);
    return { userId: payload.userId, role: payload.role };
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- booking shapes vary by endpoint
type AnyRecord = Record<string, any>;

export function safeUser(user: AnyRecord | null | undefined) {
  if (!user || typeof user !== "object") return user ?? null;
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone ?? null,
    role: user.role,
  };
}

export function healthSafetySummary(form: AnyRecord | null | undefined) {
  if (!form || typeof form !== "object") return form ?? null;
  return {
    id: form.id,
    bookingId: form.bookingId,
    accepted: form.accepted,
    declarationVersion: form.declarationVersion ?? null,
    acceptedAt: form.acceptedAt ?? null,
    submittedAt: form.submittedAt ?? null,
    createdAt: form.createdAt ?? null,
    updatedAt: form.updatedAt ?? null,
  };
}

export function canSeeHealthDetails(booking: AnyRecord | null | undefined, viewer: Viewer | null) {
  if (!viewer || !booking) return false;
  if (viewer.role === "ADMIN") return true;
  return Boolean(booking.userId) && booking.userId === viewer.userId;
}

/** A booking safe to return to this viewer (same shape, fields reduced). */
export function bookingForViewer<T extends AnyRecord | null | undefined>(booking: T, viewer: Viewer | null): T {
  if (!booking || typeof booking !== "object") return booking;
  const result: AnyRecord = { ...booking };
  if ("user" in result) result.user = safeUser(result.user);
  if ("healthSafetyForm" in result && !canSeeHealthDetails(booking, viewer)) {
    result.healthSafetyForm = healthSafetySummary(result.healthSafetyForm);
  }
  return result as T;
}
