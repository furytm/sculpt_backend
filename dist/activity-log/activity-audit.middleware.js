import prisma from "../config/prisma.js";
import { getRequestContext, runInRequestContext } from "../observability/request-context.js";
import { sanitizeText } from "../observability/sanitize.js";
import { actorFromRequest, bestEffort, record } from "./activity-events.js";
import { unmatchedDedupeKey } from "./activity-log.service.js";
const INTERNAL_TEXT = /prisma|invocation|\bat .+:\d+:\d+|[A-Za-z]:\\|\/node_modules\//i;
/** The response message, safe to store: never server details. */
function safeFailureMessage(message, status) {
    if (status >= 500)
        return `Server error (HTTP ${status}).`;
    if (typeof message !== "string" || !message.trim())
        return `Request failed (HTTP ${status}).`;
    if (INTERNAL_TEXT.test(message))
        return `Request failed (internal error, HTTP ${status}).`;
    return sanitizeText(message, 300);
}
function param(req, name) {
    if (!name)
        return null;
    const value = req.params?.[name];
    const text = Array.isArray(value) ? value[0] : value;
    return typeof text === "string" && text ? text : null;
}
export function auditAction(spec) {
    return function activityAudit(req, res, next) {
        try {
            const context = getRequestContext();
            const actor = actorFromRequest(req);
            const entityIdParam = param(req, spec.entityParam);
            const subjectParam = param(req, spec.subjectUserParam);
            const bookingBefore = spec.snapshotBooking && entityIdParam
                ? prisma.booking
                    .findUnique({
                    where: { id: entityIdParam },
                    select: { userId: true, email: true, paymentReference: true, memberMembershipId: true },
                })
                    .catch(() => null)
                : Promise.resolve(null);
            if (spec.recordInitiated) {
                record({
                    action: spec.action,
                    stage: "INITIATED",
                    status: "INFO",
                    actorType: actor.actorType,
                    actorUserId: actor.actorUserId,
                    userId: actor.memberUserId ?? (spec.subjectDeleted ? null : subjectParam),
                    entityType: spec.entityType ?? null,
                    entityId: entityIdParam,
                    description: `${spec.description} (requested)`,
                });
            }
            // Observe the JSON body without changing it.
            let body;
            const originalJson = res.json.bind(res);
            res.json = ((value) => {
                body = value;
                return originalJson(value);
            });
            res.once("finish", () => {
                void bookingBefore.then((snapshot) => runInRequestContext(context, () => bestEffort(() => {
                    const status = res.statusCode;
                    const payload = body && typeof body === "object" && "data" in body ? body.data : body;
                    const entityId = entityIdParam ?? spec.entityIdFromResponse?.(payload) ?? null;
                    const subjectUserId = spec.subjectDeleted
                        ? null
                        : actor.memberUserId ??
                            subjectParam ??
                            spec.subjectFromResponse?.(payload) ??
                            snapshot?.userId ??
                            null;
                    const subjectEmail = subjectUserId
                        ? null
                        : spec.subjectEmailFromRequest?.(req) ?? snapshot?.email ?? null;
                    const route = `${req.baseUrl ?? ""}${req.route?.path ?? ""}`;
                    if (status < 400) {
                        if (spec.onSuccess) {
                            spec.onSuccess({ req, payload, actor, entityId, bookingBefore: snapshot });
                            return;
                        }
                        record({
                            action: spec.action,
                            stage: "SUCCEEDED",
                            status: "SUCCESS",
                            actorType: actor.actorType,
                            actorUserId: actor.actorUserId,
                            userId: subjectUserId,
                            subjectEmail,
                            entityType: spec.entityType ?? null,
                            entityId,
                            paymentReference: snapshot?.paymentReference ?? null,
                            httpStatus: status,
                            description: spec.description,
                            metadata: { route, method: req.method, ...(spec.metadataFromResponse?.(payload) ?? {}) },
                        });
                        return;
                    }
                    const anonymous = !subjectUserId && !entityId && actor.actorType === "GUEST";
                    record({
                        action: spec.action,
                        stage: "FAILED",
                        status: "FAILURE",
                        actorType: actor.actorType,
                        actorUserId: actor.actorUserId,
                        userId: subjectUserId,
                        subjectEmail,
                        entityType: spec.entityType ?? null,
                        entityId,
                        paymentReference: snapshot?.paymentReference ?? null,
                        httpStatus: status,
                        errorCode: typeof body?.code === "string" ? body.code : `HTTP_${status}`,
                        errorMessage: safeFailureMessage(body?.message, status),
                        description: `${spec.description} (failed)`,
                        dedupeKey: spec.capAnonymousFailures && anonymous ? unmatchedDedupeKey(spec.action, "FAILED") : null,
                        metadata: { route, method: req.method },
                    });
                })));
            });
        }
        catch {
            // Auditing must never affect the request.
        }
        next();
    };
}
//# sourceMappingURL=activity-audit.middleware.js.map