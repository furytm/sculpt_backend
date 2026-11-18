import { describeError, sendErrorResponse } from "./errors.js";
import { logger } from "./logger.js";
import activityLog, { unmatchedDedupeKey } from "../activity-log/activity-log.service.js";
export function errorHandler(error, req, res, next) {
    const description = describeError(error, 500);
    // Unhandled business errors are still server-side failures here.
    const final = description.kind === "business"
        ? { ...description, httpStatus: 500, publicMessage: "Something went wrong. Please try again." }
        : description;
    logger.error("http.unhandled_error", {
        method: req.method,
        path: req.originalUrl.split("?")[0],
        httpStatus: final.httpStatus,
        errorCode: final.code,
        errorMessage: final.logMessage,
        // Server logs only; never sent to the browser or the activity log.
        stack: final.logStack,
    });
    // Visible in the admin error log (no stack, no internal details), at
    // most once a minute per route so a broken endpoint cannot flood it.
    try {
        const route = `${req.baseUrl ?? ""}${req.route?.path ?? ""}` || "unmatched";
        activityLog.record({
            action: "system.unhandled_error",
            stage: "FAILED",
            status: "FAILURE",
            actorType: req.user?.role === "ADMIN" ? "ADMIN" : req.user ? "MEMBER" : "GUEST",
            actorUserId: req.user?.role === "ADMIN" ? req.user.userId : null,
            userId: req.user && req.user.role !== "ADMIN" ? req.user.userId : null,
            errorCode: final.code,
            errorMessage: final.logMessage,
            httpStatus: final.httpStatus,
            description: "An error no route handled.",
            dedupeKey: `${unmatchedDedupeKey("system.unhandled_error", route)}`,
            metadata: { route, method: req.method, errorKind: final.kind },
        });
    }
    catch {
        // never affects the response
    }
    if (res.headersSent) {
        return next(error);
    }
    return sendErrorResponse(res, final, { success: false });
}
//# sourceMappingURL=error-handler.js.map