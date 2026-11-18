/**
 * Records member activity for investigation, completely independently
 * of the business operation:
 *
 * - `record()` is synchronous, returns nothing and never throws.
 * - Inside a request, events are written once the response has finished,
 *   with the request's final correlation ID (so an event recorded before
 *   the payment reference was known still joins that operation).
 *   Outside a request (jobs, tests) they are written immediately.
 * - Writes use the shared client, never a transaction client, so an
 *   event survives even when the business transaction rolls back.
 * - A failed write is reported to the console (rate-limited) and dropped.
 * - dedupeKey is unique: retries, repeated callbacks and webhooks store
 *   one event.
 */
import prisma from "../config/prisma.js";
import { getRequestContext } from "../observability/request-context.js";
import { logger } from "../observability/logger.js";
import { sanitizeIdentifier, sanitizeMetadata, sanitizeText } from "../observability/sanitize.js";
import { ALLOWED_METADATA_KEYS } from "./activity-log.types.js";
const WRITE_FAILURE_WARNING_INTERVAL_MS = 60_000;
const inFlight = new Set();
let lastWriteFailureWarning = 0;
let lastOccurredAt = 0;
/** Strictly increasing within this process, so events in one millisecond keep their order. */
function nextOccurredAt() {
    const now = Date.now();
    lastOccurredAt = now > lastOccurredAt ? now : lastOccurredAt + 1;
    return new Date(lastOccurredAt);
}
const clean = (value, max = 200) => value === null || value === undefined || value === "" ? null : sanitizeText(value, max);
/** Builds the row. Pure apart from the context; never throws. */
function buildRow(event, correlationId, requestId, occurredAt) {
    return {
        // When it happened, not when it was written: buffered and looked-up
        // events still sort in the order they occurred.
        createdAt: occurredAt,
        userId: event.userId ?? null,
        actorType: event.actorType ?? null,
        actorUserId: event.actorUserId ?? null,
        // Kept only to identify a guest who has no account; normalized.
        subjectEmail: !event.userId && event.subjectEmail ? event.subjectEmail.trim().toLowerCase().slice(0, 254) : null,
        action: event.action,
        stage: event.stage,
        status: event.status,
        description: clean(event.description, 300),
        errorCode: clean(event.errorCode, 80),
        errorMessage: clean(event.errorMessage, 500),
        httpStatus: Number.isInteger(event.httpStatus) ? event.httpStatus : null,
        entityType: event.entityType ?? null,
        // Identifiers are kept exact (never masked), only stripped of
        // characters they can't contain.
        entityId: sanitizeIdentifier(event.entityId, 64),
        paymentReference: sanitizeIdentifier(event.paymentReference, 100),
        correlationId: sanitizeIdentifier(correlationId, 100),
        requestId: sanitizeIdentifier(requestId, 64),
        dedupeKey: sanitizeIdentifier(event.dedupeKey, 200),
        metadata: sanitizeMetadata(event.metadata, ALLOWED_METADATA_KEYS) ?? undefined,
    };
}
/** Fills the purchase/booking and owner from a payment reference, when not given. */
async function resolveFromPaymentReference(row) {
    if (!row.paymentReference || (row.entityId && row.userId))
        return row;
    const purchase = await prisma.membershipPurchase.findUnique({
        where: { paymentReference: row.paymentReference },
        select: { id: true, userId: true, email: true, type: true },
    });
    if (purchase) {
        return {
            ...row,
            entityType: row.entityType ?? "MEMBERSHIP_PURCHASE",
            entityId: row.entityId ?? purchase.id,
            userId: row.userId ?? purchase.userId,
            subjectEmail: (row.userId ?? purchase.userId) ? null : row.subjectEmail ?? purchase.email.toLowerCase(),
            // Completion events say which kind of purchase completed
            // (NEW / RENEWAL / UPGRADE), without an extra event.
            metadata: row.action === "membership.purchase_completion" && !row.metadata?.purchaseType
                ? { ...(row.metadata ?? {}), purchaseType: purchase.type }
                : row.metadata,
        };
    }
    const booking = await prisma.booking.findUnique({
        where: { paymentReference: row.paymentReference },
        select: { id: true, userId: true, email: true },
    });
    if (booking) {
        return {
            ...row,
            entityType: row.entityType ?? "BOOKING",
            entityId: row.entityId ?? booking.id,
            userId: row.userId ?? booking.userId,
            subjectEmail: (row.userId ?? booking.userId) ? null : row.subjectEmail ?? booking.email?.toLowerCase() ?? null,
        };
    }
    // Matches nothing we know (for example a made-up reference sent to the
    // public callback): store at most one such event per kind per minute,
    // so these endpoints can't be used to flood the log.
    if (row.entityId || row.userId)
        return row;
    return {
        ...row,
        dedupeKey: row.dedupeKey ?? unmatchedDedupeKey(row.action, row.stage),
    };
}
/**
 * Fills the affected member (and, for guests, the email) from the
 * entity the event is about, when the event doesn't name one. This is
 * how an admin action on a booking or purchase gets its subject.
 */
async function resolveOwnerFromEntity(row) {
    if (row.userId || !row.entityType || !row.entityId)
        return row;
    let owner = null;
    if (row.entityType === "BOOKING") {
        owner = await prisma.booking.findUnique({
            where: { id: row.entityId },
            select: { userId: true, email: true, paymentReference: true },
        });
    }
    else if (row.entityType === "MEMBERSHIP_PURCHASE") {
        owner = await prisma.membershipPurchase.findUnique({
            where: { id: row.entityId },
            select: { userId: true, email: true, paymentReference: true },
        });
    }
    else if (row.entityType === "MEMBER_MEMBERSHIP") {
        owner = await prisma.memberMembership.findUnique({
            where: { id: row.entityId },
            select: { userId: true },
        });
    }
    else if (row.entityType === "USER") {
        const user = await prisma.user.findUnique({ where: { id: row.entityId }, select: { id: true } });
        owner = user ? { userId: user.id } : null;
    }
    if (!owner)
        return row;
    return {
        ...row,
        userId: owner.userId,
        subjectEmail: owner.userId ? null : row.subjectEmail ?? owner.email?.toLowerCase() ?? null,
        paymentReference: row.paymentReference ?? owner.paymentReference ?? null,
    };
}
/** One event per action and stage per minute. */
export function unmatchedDedupeKey(action, stage, now = Date.now()) {
    return `unmatched:${action}:${stage}:${Math.floor(now / 60_000)}`;
}
async function persist(row) {
    try {
        const resolved = await resolveFromPaymentReference(await resolveOwnerFromEntity(row));
        const data = {
            ...resolved,
            actorType: resolved.actorType ?? (resolved.userId ? "MEMBER" : "GUEST"),
        };
        try {
            await prisma.memberActivityLog.create({ data });
        }
        catch (error) {
            // The subject account no longer exists (e.g. just deleted): keep
            // the event, without the link to the account.
            const code = error?.code;
            if (code === "P2003" && data.userId) {
                await prisma.memberActivityLog.create({
                    data: {
                        ...data,
                        userId: null,
                        entityType: data.entityType ?? "USER",
                        entityId: data.entityId ?? data.userId,
                    },
                });
                return;
            }
            throw error;
        }
    }
    catch (error) {
        const code = error?.code;
        const target = String(error?.meta?.target ?? "");
        // A duplicate dedupeKey is the intended outcome of a retry.
        if (code === "P2002" && target.includes("dedupeKey"))
            return;
        const now = Date.now();
        if (now - lastWriteFailureWarning > WRITE_FAILURE_WARNING_INTERVAL_MS) {
            lastWriteFailureWarning = now;
            logger.warn("activity_log.write_failed", {
                action: row.action,
                stage: row.stage,
                errorCode: typeof code === "string" ? code : null,
                errorName: error instanceof Error ? error.name : typeof error,
            });
        }
    }
}
function startWrite(row) {
    try {
        const write = persist(row).catch(() => undefined);
        inFlight.add(write);
        void write.finally(() => inFlight.delete(write));
    }
    catch {
        // Never reaches the business operation.
    }
}
export const activityLog = {
    /** Records an event. Never throws, never blocks, never joins a transaction. */
    record(event) {
        try {
            const occurredAt = nextOccurredAt();
            const context = getRequestContext();
            // Buffer until the response finishes (only for HTTP requests, whose
            // middleware runs onFinish); otherwise write now.
            if (context && context.path !== undefined && !context.finished) {
                context.onFinish.push(() => startWrite(buildRow(event, event.correlationId ?? context.correlationId ?? context.requestId, context.requestId, occurredAt)));
                return;
            }
            startWrite(buildRow(event, event.correlationId ?? context?.correlationId ?? context?.requestId ?? null, context?.requestId ?? null, occurredAt));
        }
        catch {
            // Logging must never affect the operation being logged.
        }
    },
    /**
     * Waits for writes already started (tests, graceful shutdown).
     * With a timeout, gives up after that many milliseconds and resolves
     * false, so shutdown can never hang on logging. Never rejects.
     */
    async flush(timeoutMs) {
        const drain = (async () => {
            await new Promise((resolve) => setImmediate(resolve));
            while (inFlight.size) {
                await Promise.allSettled([...inFlight]);
            }
            return true;
        })().catch(() => true);
        if (timeoutMs === undefined)
            return drain;
        let timer;
        const timedOut = new Promise((resolve) => {
            timer = setTimeout(() => resolve(false), Math.max(0, timeoutMs));
            timer.unref?.();
        });
        try {
            return await Promise.race([drain, timedOut]);
        }
        finally {
            if (timer)
                clearTimeout(timer);
        }
    },
    /** Number of writes still in progress (diagnostics and tests). */
    pendingWrites() {
        return inFlight.size;
    },
};
/** Tests only: resets the once-a-minute write-failure warning limiter. */
export function resetActivityLogWarningLimiterForTests() {
    lastWriteFailureWarning = 0;
}
export default activityLog;
//# sourceMappingURL=activity-log.service.js.map