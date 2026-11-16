import { UserRole } from "@prisma/client";
/**
 * The only API routes a TUTOR account may use. A tutor's token is
 * refused everywhere else: admin APIs, member booking, membership,
 * payment and profile APIs, and any route added later, until it is
 * listed here on purpose.
 *
 * ADMIN and MEMBER tokens are never affected.
 */
const TUTOR_ALLOWED_ROUTES = [
    // Read-only: the tutor's own schedule (scoped by the controller).
    { method: "GET", path: "/api/admin/tutor-schedule" },
    // The signed-in account, so the admin app can show who is logged in.
    { method: "GET", path: "/api/auth/me" },
];
function requestPath(req) {
    const path = req.originalUrl.split("?")[0].replace(/\/+$/, "");
    // Express matches routes case-insensitively, so compare the same way.
    return (path || "/").toLowerCase();
}
export function isTutorRouteAllowed(req) {
    const path = requestPath(req);
    return TUTOR_ALLOWED_ROUTES.some((route) => route.method === req.method && route.path === path);
}
/**
 * Refuse a TUTOR on any route outside the allow-list. Returns true when
 * the response has been sent (the caller must stop).
 */
export function rejectTutorOutsideAllowedRoutes(req, res) {
    if (req.user?.role !== UserRole.TUTOR || isTutorRouteAllowed(req)) {
        return false;
    }
    res.status(403).json({
        success: false,
        message: "Tutor accounts can only view their own tutor schedule.",
    });
    return true;
}
//# sourceMappingURL=tutorAccess.js.map