import { verifyAccessToken } from "../utils/jwt.js";
/**
 * The signed-in viewer, if any, WITHOUT rejecting the request: a missing,
 * invalid or expired token simply means "not signed in", so public
 * booking pages keep working exactly as before.
 */
export function viewerFromRequest(req) {
    try {
        if (req.user)
            return { userId: req.user.userId, role: req.user.role };
        const token = req.cookies?.accessToken ||
            req.headers.authorization?.replace(/^Bearer\s+/, "");
        if (!token)
            return null;
        const payload = verifyAccessToken(token);
        return { userId: payload.userId, role: payload.role };
    }
    catch {
        return null;
    }
}
export function safeUser(user) {
    if (!user || typeof user !== "object")
        return user ?? null;
    return {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone ?? null,
        role: user.role,
    };
}
export function healthSafetySummary(form) {
    if (!form || typeof form !== "object")
        return form ?? null;
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
export function canSeeHealthDetails(booking, viewer) {
    if (!viewer || !booking)
        return false;
    if (viewer.role === "ADMIN")
        return true;
    return Boolean(booking.userId) && booking.userId === viewer.userId;
}
/** A booking safe to return to this viewer (same shape, fields reduced). */
export function bookingForViewer(booking, viewer) {
    if (!booking || typeof booking !== "object")
        return booking;
    const result = { ...booking };
    if ("user" in result)
        result.user = safeUser(result.user);
    if ("healthSafetyForm" in result && !canSeeHealthDetails(booking, viewer)) {
        result.healthSafetyForm = healthSafetySummary(result.healthSafetyForm);
    }
    return result;
}
//# sourceMappingURL=booking-privacy.js.map