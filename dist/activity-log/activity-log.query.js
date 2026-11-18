import prisma from "../config/prisma.js";
import { sanitizeMetadata } from "../observability/sanitize.js";
import { ALLOWED_METADATA_KEYS } from "./activity-log.types.js";
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_TIMELINE_EVENTS = 500;
const OUTPUT_METADATA_KEYS = new Set([...ALLOWED_METADATA_KEYS, "droppedFields"]);
const SELECT = {
    id: true,
    createdAt: true,
    action: true,
    stage: true,
    status: true,
    actorType: true,
    actorUserId: true,
    userId: true,
    subjectEmail: true,
    description: true,
    errorCode: true,
    errorMessage: true,
    httpStatus: true,
    entityType: true,
    entityId: true,
    paymentReference: true,
    correlationId: true,
    requestId: true,
    metadata: true,
    user: { select: { id: true, fullName: true, email: true, role: true } },
};
const ORDER_NEWEST = [
    { createdAt: "desc" },
    { id: "desc" },
];
const ORDER_OLDEST = [
    { createdAt: "asc" },
    { id: "asc" },
];
const inList = (values) => (values?.length ? { in: values } : undefined);
export function buildWhere(filters) {
    const and = [];
    if (filters.status?.length)
        and.push({ status: inList(filters.status) });
    if (filters.action?.length)
        and.push({ action: inList(filters.action) });
    if (filters.actorType?.length)
        and.push({ actorType: inList(filters.actorType) });
    if (filters.entityType?.length)
        and.push({ entityType: inList(filters.entityType) });
    if (filters.subjectUserId)
        and.push({ userId: filters.subjectUserId });
    if (filters.subjectEmail)
        and.push({ subjectEmail: filters.subjectEmail });
    if (filters.entityId)
        and.push({ entityId: filters.entityId });
    if (filters.correlationId)
        and.push({ correlationId: filters.correlationId });
    if (filters.requestId)
        and.push({ requestId: filters.requestId });
    if (filters.paymentReference)
        and.push({ paymentReference: filters.paymentReference });
    if (filters.errorCode)
        and.push({ errorCode: filters.errorCode });
    if (filters.httpStatus !== undefined)
        and.push({ httpStatus: filters.httpStatus });
    if (filters.from || filters.to) {
        and.push({ createdAt: { ...(filters.from && { gte: filters.from }), ...(filters.to && { lte: filters.to }) } });
    }
    // Free-text search: only descriptive and reference fields, never
    // metadata. Identifiers match exactly; text matches partially.
    if (filters.search) {
        const term = filters.search;
        and.push({
            OR: [
                { description: { contains: term, mode: "insensitive" } },
                { errorMessage: { contains: term, mode: "insensitive" } },
                { errorCode: { contains: term, mode: "insensitive" } },
                { action: { contains: term, mode: "insensitive" } },
                { subjectEmail: { contains: term, mode: "insensitive" } },
                { paymentReference: { contains: term, mode: "insensitive" } },
                { user: { is: { email: { contains: term, mode: "insensitive" } } } },
                { user: { is: { fullName: { contains: term, mode: "insensitive" } } } },
                { entityId: term },
                { correlationId: term },
                { requestId: term },
            ],
        });
    }
    return and.length ? { AND: and } : {};
}
/** The safe API shape of one event. */
export function toApiItem(row, actors) {
    const actor = row.actorUserId ? actors.get(row.actorUserId) : undefined;
    return {
        id: row.id,
        occurredAt: row.createdAt,
        action: row.action,
        stage: row.stage,
        status: row.status,
        description: row.description,
        actor: {
            type: row.actorType,
            userId: row.actorUserId,
            name: actor?.fullName ?? null,
            email: actor?.email ?? null,
        },
        subject: {
            userId: row.userId,
            name: row.user?.fullName ?? null,
            email: row.user?.email ?? row.subjectEmail ?? null,
            role: row.user?.role ?? null,
            isGuest: !row.userId && Boolean(row.subjectEmail),
        },
        entity: row.entityType || row.entityId ? { type: row.entityType, id: row.entityId } : null,
        paymentReference: row.paymentReference,
        correlationId: row.correlationId,
        requestId: row.requestId,
        error: row.errorCode || row.errorMessage || row.httpStatus
            ? { code: row.errorCode, message: row.errorMessage, httpStatus: row.httpStatus }
            : null,
        metadata: outputMetadata(row.metadata),
    };
}
/**
 * Defence in depth: metadata is allow-listed when written; filter it
 * again on the way out. Only a write-time droppedFields count is shown.
 */
function outputMetadata(stored) {
    const output = sanitizeMetadata(stored, OUTPUT_METADATA_KEYS) ?? {};
    const storedCount = stored && typeof stored === "object" && !Array.isArray(stored)
        ? stored.droppedFields
        : undefined;
    if (typeof storedCount === "number")
        output.droppedFields = storedCount;
    else
        delete output.droppedFields;
    return output;
}
async function actorsFor(rows) {
    const ids = [...new Set(rows.map((row) => row.actorUserId).filter((id) => Boolean(id)))];
    if (!ids.length)
        return new Map();
    const users = await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, fullName: true, email: true },
    });
    return new Map(users.map((user) => [user.id, user]));
}
async function page(where, pageNumber, limit) {
    const [rows, total] = await Promise.all([
        prisma.memberActivityLog.findMany({
            where,
            orderBy: ORDER_NEWEST,
            skip: (pageNumber - 1) * limit,
            take: limit,
            select: SELECT,
        }),
        prisma.memberActivityLog.count({ where }),
    ]);
    const actors = await actorsFor(rows);
    const totalPages = Math.max(Math.ceil(total / limit), 1);
    return {
        items: rows.map((row) => toApiItem(row, actors)),
        pagination: {
            page: pageNumber,
            limit,
            total,
            totalPages,
            hasNextPage: pageNumber < totalPages,
            hasPreviousPage: pageNumber > 1,
        },
    };
}
export const activityLogQuery = {
    /** Central activity log. */
    async list(filters) {
        return page(buildWhere(filters), filters.page, filters.limit);
    },
    /** Failures (and optionally warnings). */
    async errors(filters) {
        const status = filters.includeWarnings ? ["FAILURE", "WARNING"] : ["FAILURE"];
        return page(buildWhere({ ...filters, status }), filters.page, filters.limit);
    },
    /**
     * One member's history: events about them (including admin actions
     * on them), and guest events made with their email before they had an
     * account. Returns null when the member doesn't exist.
     */
    async forMember(memberId, filters) {
        const member = await prisma.user.findUnique({
            where: { id: memberId },
            select: { id: true, fullName: true, email: true, role: true },
        });
        if (!member)
            return null;
        const ownership = {
            OR: [
                { userId: member.id },
                { userId: null, subjectEmail: member.email.toLowerCase() },
            ],
        };
        const where = {
            AND: [ownership, buildWhere({ ...filters, subjectUserId: undefined, subjectEmail: undefined })],
        };
        return { member, ...(await page(where, filters.page, filters.limit)) };
    },
    /** Every event of one operation, oldest first. Null when there are none. */
    async operation(correlationId) {
        const rows = await prisma.memberActivityLog.findMany({
            where: { correlationId },
            orderBy: ORDER_OLDEST,
            take: MAX_TIMELINE_EVENTS,
            select: SELECT,
        });
        if (!rows.length)
            return null;
        const actors = await actorsFor(rows);
        const events = rows.map((row) => toApiItem(row, actors));
        const distinct = (values) => [...new Set(values.filter((value) => value !== null && value !== undefined))];
        const subjects = new Map();
        for (const event of events) {
            const key = event.subject.userId ?? event.subject.email;
            if (key && !subjects.has(key))
                subjects.set(key, event.subject);
        }
        const last = events[events.length - 1];
        return {
            correlationId,
            startedAt: events[0].occurredAt,
            endedAt: last.occurredAt,
            eventCount: events.length,
            truncated: rows.length === MAX_TIMELINE_EVENTS,
            latestStatus: last.status,
            hasFailures: events.some((event) => event.status === "FAILURE"),
            paymentReferences: distinct(events.map((event) => event.paymentReference)),
            requestIds: distinct(events.map((event) => event.requestId)),
            entities: distinct(events.map((event) => (event.entity?.id ? `${event.entity.type}:${event.entity.id}` : null))).map((key) => {
                const [type, ...id] = key.split(":");
                return { type, id: id.join(":") };
            }),
            subjects: [...subjects.values()],
            events,
        };
    },
};
//# sourceMappingURL=activity-log.query.js.map