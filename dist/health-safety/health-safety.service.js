/**
 * Member and admin Health & Safety declarations, with immutable revision
 * history (HealthSafetyRevision).
 *
 * - A booking's HealthSafetyForm stays the CURRENT declaration for that
 *   booking; every change made here also writes an immutable revision,
 *   in the same transaction.
 * - The member's own declaration is a member-level revision (kind
 *   MEMBER), with or without bookings. A member update records it and
 *   applies it to all their upcoming bookings (see upcomingBookings);
 *   past bookings keep the declaration they were made with. No booking
 *   is invented.
 * - The checkout declaration routes (PENDING bookings only) are separate
 *   and unchanged; nothing here is used by them.
 *
 * Notes are never logged or put in notifications.
 */
import { BookingStatus, PaymentStatus, Prisma, SessionStatus } from "@prisma/client";
import prisma from "../config/prisma.js";
/** Same version string the checkout declaration records. */
export const HEALTH_DECLARATION_VERSION = "1.0";
export const MAX_NOTES_LENGTH = 2000;
export const MAX_REVISIONS_RETURNED = 50;
export class HealthSafetyError extends Error {
    status;
    code;
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
        this.name = "HealthSafetyError";
    }
}
const BOOKING_CONTEXT = {
    select: {
        id: true,
        userId: true,
        fullName: true,
        email: true,
        phone: true,
        bookingStatus: true,
        paymentStatus: true,
        paymentReference: true,
        classId: true,
        bookingDate: true,
        session: {
            select: {
                id: true,
                sessionDate: true,
                status: true,
                schedule: { select: { className: true, startTime: true, endTime: true, tutorName: true } },
            },
        },
    },
};
const REVISION_SELECT = {
    id: true,
    kind: true,
    formId: true,
    bookingId: true,
    accepted: true,
    notes: true,
    declarationVersion: true,
    acceptedAt: true,
    submittedAt: true,
    source: true,
    actorType: true,
    createdAt: true,
};
/** Forms that belong to the member: linked to them, or on their booking. */
const memberFormsWhere = (userId) => ({
    OR: [{ userId }, { booking: { userId } }],
});
function bookingSummary(booking) {
    if (!booking)
        return null;
    return {
        id: booking.id,
        bookingStatus: booking.bookingStatus,
        paymentStatus: booking.paymentStatus,
        paymentReference: booking.paymentReference,
        className: booking.session?.schedule.className ?? booking.classId ?? null,
        sessionId: booking.session?.id ?? null,
        sessionDate: booking.session?.sessionDate ?? booking.bookingDate ?? null,
        startTime: booking.session?.schedule.startTime ?? null,
        endTime: booking.session?.schedule.endTime ?? null,
        sessionStatus: booking.session?.status ?? null,
    };
}
const toRevision = (row) => ({
    id: row.id,
    kind: row.kind,
    formId: row.formId,
    bookingId: row.bookingId,
    accepted: row.accepted,
    notes: row.notes,
    declarationVersion: row.declarationVersion,
    acceptedAt: row.acceptedAt,
    submittedAt: row.submittedAt,
    source: row.source,
    actorType: row.actorType,
    createdAt: row.createdAt,
});
async function memberView(userId, client = prisma) {
    const [forms, latestMemberRevision] = await Promise.all([
        client.healthSafetyForm.findMany({
            where: memberFormsWhere(userId),
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: {
                id: true,
                bookingId: true,
                accepted: true,
                notes: true,
                declarationVersion: true,
                acceptedAt: true,
                submittedAt: true,
                createdAt: true,
                updatedAt: true,
                booking: BOOKING_CONTEXT,
                _count: { select: { revisions: true } },
            },
        }),
        client.healthSafetyRevision.findFirst({
            where: { userId, kind: "MEMBER" },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: REVISION_SELECT,
        }),
    ]);
    const memberRevisionCount = latestMemberRevision
        ? await client.healthSafetyRevision.count({ where: { userId, kind: "MEMBER" } })
        : 0;
    const declarations = forms.map((form) => ({
        kind: "BOOKING",
        formId: form.id,
        bookingId: form.bookingId,
        accepted: form.accepted,
        notes: form.notes,
        declarationVersion: form.declarationVersion,
        acceptedAt: form.acceptedAt,
        submittedAt: form.submittedAt,
        updatedAt: form.updatedAt,
        booking: bookingSummary(form.booking),
        // Forms created before any update have no revision yet; their
        // current state counts as the first version.
        revisionCount: Math.max(form._count.revisions, 1),
    }));
    if (latestMemberRevision) {
        declarations.push({
            kind: "MEMBER",
            formId: null,
            bookingId: null,
            accepted: latestMemberRevision.accepted,
            notes: latestMemberRevision.notes,
            declarationVersion: latestMemberRevision.declarationVersion,
            acceptedAt: latestMemberRevision.acceptedAt,
            submittedAt: latestMemberRevision.submittedAt,
            updatedAt: latestMemberRevision.createdAt,
            booking: null,
            revisionCount: memberRevisionCount,
        });
    }
    // The current declaration is the most recently updated one. A member
    // update writes the member-level declaration and its bookings at the
    // same instant; the member-level one is then the current.
    declarations.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() ||
        (a.kind === b.kind ? 0 : a.kind === "MEMBER" ? -1 : 1));
    const current = declarations[0] ?? null;
    const revisions = !current
        ? []
        : (await client.healthSafetyRevision.findMany({
            where: current.kind === "MEMBER" ? { userId, kind: "MEMBER" } : { formId: current.formId },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: MAX_REVISIONS_RETURNED,
            select: REVISION_SELECT,
        })).map(toRevision);
    return { current, revisions, declarations };
}
/*
 * Upcoming bookings
 * -----------------
 * A booking receives the member's updated declaration when ALL hold:
 *
 * - it is the member's own booking (Booking.userId), never a guest's;
 * - it is CONFIRMED, or PENDING with payment PAID (a paid booking still
 *   finishing checkout). Unpaid PENDING checkouts and CANCELLED bookings
 *   are left alone;
 * - it has a class session that is OPEN or FULL (not CANCELLED or
 *   COMPLETED);
 * - the session starts after now, in Lagos time: sessionDate holds the
 *   Lagos calendar date at UTC midnight and schedule.startTime is Lagos
 *   local time (UTC+1, no daylight saving), as everywhere else in the
 *   booking service.
 *
 * A CONFIRMED upcoming booking without a form gets one (one per booking,
 * bookingId is unique). A PENDING booking without a form is left to its
 * checkout, which collects the declaration itself.
 */
const LAGOS_OFFSET_MS = 60 * 60 * 1000;
/** The Lagos calendar date of `now`, as UTC midnight (sessionDate's encoding). */
function lagosToday(now) {
    const lagos = new Date(now.getTime() + LAGOS_OFFSET_MS);
    return new Date(Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), lagos.getUTCDate()));
}
/** "14:00", "14:00:00", "2:00 PM" → minutes after midnight; null if unreadable. */
function parseStartMinutes(startTime) {
    const match = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i.exec((startTime ?? "").trim());
    if (!match)
        return null;
    let hours = Number(match[1]);
    const minutes = Number(match[2]);
    const meridiem = match[3]?.toUpperCase();
    if (meridiem) {
        if (hours < 1 || hours > 12)
            return null;
        hours = (hours % 12) + (meridiem === "PM" ? 12 : 0);
    }
    if (hours > 23 || minutes > 59)
        return null;
    return hours * 60 + minutes;
}
/** When the class starts (UTC instant). Unreadable start time: end of that Lagos day. */
export function sessionStartsAt(sessionDate, startTime) {
    const minutes = parseStartMinutes(startTime) ?? 24 * 60 - 1;
    const day = Date.UTC(sessionDate.getUTCFullYear(), sessionDate.getUTCMonth(), sessionDate.getUTCDate());
    return new Date(day + minutes * 60 * 1000 - LAGOS_OFFSET_MS);
}
async function upcomingBookings(tx, userId, now) {
    const rows = await tx.booking.findMany({
        where: {
            userId,
            OR: [
                { bookingStatus: BookingStatus.CONFIRMED },
                { bookingStatus: BookingStatus.PENDING, paymentStatus: PaymentStatus.PAID },
            ],
            session: {
                is: {
                    status: { in: [SessionStatus.OPEN, SessionStatus.FULL] },
                    sessionDate: { gte: lagosToday(now) },
                },
            },
        },
        select: {
            id: true,
            bookingStatus: true,
            session: { select: { sessionDate: true, schedule: { select: { startTime: true } } } },
            healthSafetyForm: true,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows.filter((row) => row.session && sessionStartsAt(row.session.sessionDate, row.session.schedule.startTime) > now);
}
const sameDeclaration = (state, notes) => state.accepted === true && (state.notes ?? null) === notes && state.declarationVersion === HEALTH_DECLARATION_VERSION;
export const healthSafetyService = {
    /** GET: the member's current declaration, its revisions, and all their declarations. */
    async getForMember(userId) {
        return memberView(userId);
    },
    /**
     * PATCH: one atomic transaction. It
     *
     * 1. records the member-level declaration (an immutable MEMBER
     *    revision), and
     * 2. applies it to every upcoming eligible booking (see
     *    upcomingBookings): each changed form gets a BASELINE revision of
     *    its prior state when it has none yet, is updated, and gets an
     *    immutable MEMBER_UPDATE revision.
     *
     * Past, cancelled and other people's bookings are never touched.
     * Re-submitting the same declaration changes nothing and writes no
     * revisions (retries and double submits are no-ops). Any failure
     * rolls back everything.
     */
    async updateForMember(userId, input) {
        const notes = input.notes?.trim() ? input.notes.trim() : null;
        let result;
        try {
            result = await prisma.$transaction(async (tx) => {
                // One update per member at a time.
                await tx.$queryRaw `SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
                const member = await tx.user.findUnique({
                    where: { id: userId },
                    select: { id: true, fullName: true, role: true },
                });
                if (!member)
                    throw new HealthSafetyError(404, "MEMBER_NOT_FOUND", "Member account not found.");
                // A named booking must be the member's. Another member's booking
                // (or none) looks the same: not found.
                if (input.bookingId) {
                    const owned = await tx.healthSafetyForm.findFirst({
                        where: { AND: [{ bookingId: input.bookingId }, memberFormsWhere(userId)] },
                        select: { id: true },
                    });
                    if (!owned) {
                        throw new HealthSafetyError(404, "DECLARATION_NOT_FOUND", "No Health & Safety declaration was found for this booking.");
                    }
                }
                const now = new Date();
                const declared = {
                    accepted: true,
                    notes,
                    declarationVersion: HEALTH_DECLARATION_VERSION,
                    acceptedAt: now,
                    submittedAt: now,
                };
                // 1. The member-level declaration.
                const latestMember = await tx.healthSafetyRevision.findFirst({
                    where: { userId, kind: "MEMBER" },
                    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                    select: { id: true, accepted: true, notes: true, declarationVersion: true },
                });
                let memberRevisionId = null;
                if (!latestMember || !sameDeclaration(latestMember, notes)) {
                    const revision = await tx.healthSafetyRevision.create({
                        data: {
                            kind: "MEMBER",
                            userId,
                            ...declared,
                            source: "MEMBER_UPDATE",
                            actorType: "MEMBER",
                            actorUserId: userId,
                            createdAt: now,
                        },
                        select: { id: true },
                    });
                    memberRevisionId = revision.id;
                }
                // 2. Every upcoming eligible booking.
                const updatedBookings = [];
                for (const booking of await upcomingBookings(tx, userId, now)) {
                    let form = booking.healthSafetyForm;
                    if (!form) {
                        // Checkout collects the declaration of a booking still in it.
                        if (booking.bookingStatus !== BookingStatus.CONFIRMED)
                            continue;
                        const created = await tx.healthSafetyForm.create({
                            data: {
                                bookingId: booking.id,
                                userId,
                                ...declared,
                                // Same defaults the checkout declaration uses.
                                screeningAnswers: {},
                                consent: [],
                            },
                        });
                        const revision = await tx.healthSafetyRevision.create({
                            data: {
                                kind: "BOOKING",
                                formId: created.id,
                                userId,
                                bookingId: booking.id,
                                ...declared,
                                source: "MEMBER_UPDATE",
                                actorType: "MEMBER",
                                actorUserId: userId,
                                createdAt: now,
                            },
                            select: { id: true },
                        });
                        updatedBookings.push({ bookingId: booking.id, formId: created.id, revisionId: revision.id, formCreated: true });
                        continue;
                    }
                    if (sameDeclaration(form, notes))
                        continue;
                    // Keep the state before its first change (forms created at
                    // checkout after the migration have no revision yet).
                    const existingRevisions = await tx.healthSafetyRevision.count({ where: { formId: form.id } });
                    if (existingRevisions === 0) {
                        await tx.healthSafetyRevision.create({
                            data: {
                                kind: "BOOKING",
                                formId: form.id,
                                userId,
                                bookingId: form.bookingId,
                                accepted: form.accepted,
                                notes: form.notes,
                                declarationVersion: form.declarationVersion,
                                acceptedAt: form.acceptedAt,
                                submittedAt: form.submittedAt,
                                source: "BASELINE",
                                actorType: "SYSTEM",
                                createdAt: form.submittedAt ?? form.createdAt,
                            },
                        });
                    }
                    // Only the declaration fields change; the booking link, the
                    // owner and the checkout's other answers are kept.
                    form = await tx.healthSafetyForm.update({
                        where: { id: form.id },
                        data: { ...declared, updatedAt: now },
                    });
                    const revision = await tx.healthSafetyRevision.create({
                        data: {
                            kind: "BOOKING",
                            formId: form.id,
                            userId,
                            bookingId: form.bookingId,
                            ...declared,
                            source: "MEMBER_UPDATE",
                            actorType: "MEMBER",
                            actorUserId: userId,
                            // Strictly after the baseline, even within one millisecond.
                            createdAt: new Date(Math.max(now.getTime(), (booking.healthSafetyForm.submittedAt ?? booking.healthSafetyForm.createdAt).getTime() + 1)),
                        },
                        select: { id: true },
                    });
                    updatedBookings.push({ bookingId: form.bookingId, formId: form.id, revisionId: revision.id, formCreated: false });
                }
                const changed = memberRevisionId !== null || updatedBookings.length > 0;
                const primary = memberRevisionId
                    ? { kind: "MEMBER", formId: null, bookingId: null, revisionId: memberRevisionId }
                    : updatedBookings[0]
                        ? { kind: "BOOKING", ...updatedBookings[0] }
                        : // Unchanged resubmission: the member-level declaration already says this.
                            { kind: "MEMBER", formId: null, bookingId: null, revisionId: latestMember.id };
                return {
                    member,
                    kind: primary.kind,
                    formId: primary.formId,
                    bookingId: primary.bookingId,
                    revisionId: primary.revisionId,
                    changed,
                    updatedBookings,
                };
            }, { maxWait: 10000, timeout: 15000 });
        }
        catch (error) {
            // A checkout created the same booking's form at the same moment.
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                throw new HealthSafetyError(409, "DECLARATION_CONFLICT", "Your declaration changed while saving. Please try again.");
            }
            throw error;
        }
        return { ...result, view: await memberView(userId) };
    },
    /** Admin: one member-level or booking declaration's revision history. */
    async adminRevisions(where) {
        const rows = await prisma.healthSafetyRevision.findMany({
            where: where.formId ? { formId: where.formId } : { userId: where.userId },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 200,
            select: { ...REVISION_SELECT, userId: true },
        });
        return rows.map((row) => ({ ...toRevision(row), userId: row.userId }));
    },
    /**
     * Admin list: every booking declaration (one record per booking) and
     * every member-level declaration, newest update first.
     */
    async adminList(filters) {
        const includeBooking = filters.kind !== "MEMBER";
        const includeMember = filters.kind !== "BOOKING";
        const window = filters.page * filters.limit;
        const formWhere = {
            AND: [
                filters.userId ? memberFormsWhere(filters.userId) : {},
                filters.bookingId ? { bookingId: filters.bookingId } : {},
                filters.accepted !== undefined ? { accepted: filters.accepted } : {},
                filters.from || filters.to
                    ? { updatedAt: { ...(filters.from && { gte: filters.from }), ...(filters.to && { lte: filters.to }) } }
                    : {},
                filters.search
                    ? {
                        OR: [
                            { user: { is: { fullName: { contains: filters.search, mode: "insensitive" } } } },
                            { user: { is: { email: { contains: filters.search, mode: "insensitive" } } } },
                            { user: { is: { phone: { contains: filters.search } } } },
                            { booking: { is: { fullName: { contains: filters.search, mode: "insensitive" } } } },
                            { booking: { is: { email: { contains: filters.search, mode: "insensitive" } } } },
                            { booking: { is: { phone: { contains: filters.search } } } },
                            { booking: { is: { paymentReference: { contains: filters.search, mode: "insensitive" } } } },
                        ],
                    }
                    : {},
            ],
        };
        const memberWhere = {
            AND: [
                { kind: "MEMBER", userId: filters.userId ?? { not: null } },
                filters.bookingId ? { id: "__none__" } : {},
                filters.search
                    ? {
                        user: {
                            is: {
                                OR: [
                                    { fullName: { contains: filters.search, mode: "insensitive" } },
                                    { email: { contains: filters.search, mode: "insensitive" } },
                                    { phone: { contains: filters.search } },
                                ],
                            },
                        },
                    }
                    : {},
            ],
        };
        const [forms, formTotal, memberLatest] = await Promise.all([
            includeBooking
                ? prisma.healthSafetyForm.findMany({
                    where: formWhere,
                    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
                    take: window,
                    select: {
                        id: true,
                        userId: true,
                        bookingId: true,
                        accepted: true,
                        notes: true,
                        declarationVersion: true,
                        acceptedAt: true,
                        submittedAt: true,
                        updatedAt: true,
                        user: { select: { id: true, fullName: true, email: true, phone: true } },
                        booking: BOOKING_CONTEXT,
                        _count: { select: { revisions: true } },
                    },
                })
                : Promise.resolve([]),
            includeBooking ? prisma.healthSafetyForm.count({ where: formWhere }) : Promise.resolve(0),
            // The latest member-level revision of each member is their current
            // member-level declaration.
            includeMember
                ? prisma.healthSafetyRevision.findMany({
                    where: memberWhere,
                    orderBy: [{ userId: "asc" }, { createdAt: "desc" }, { id: "desc" }],
                    distinct: ["userId"],
                    select: {
                        ...REVISION_SELECT,
                        userId: true,
                        user: { select: { id: true, fullName: true, email: true, phone: true } },
                    },
                })
                : Promise.resolve([]),
        ]);
        // Apply accepted/date filters to the member-level current state.
        const members = memberLatest.filter((row) => (filters.accepted === undefined || row.accepted === filters.accepted) &&
            (!filters.from || row.createdAt >= filters.from) &&
            (!filters.to || row.createdAt <= filters.to));
        const memberCounts = members.length
            ? await prisma.healthSafetyRevision.groupBy({
                by: ["userId"],
                where: { kind: "MEMBER", userId: { in: members.map((row) => row.userId) } },
                _count: { _all: true },
            })
            : [];
        const memberCountBy = new Map(memberCounts.map((row) => [row.userId, row._count._all]));
        const records = [
            ...forms.map((form) => ({
                id: form.id,
                kind: "BOOKING",
                formId: form.id,
                userId: form.userId ?? form.booking.userId ?? null,
                // Contact details: the member's account, or the booking (guests).
                fullName: form.user?.fullName ?? form.booking.fullName ?? null,
                email: form.user?.email ?? form.booking.email ?? null,
                phone: form.user?.phone ?? form.booking.phone ?? null,
                isGuest: !(form.userId ?? form.booking.userId),
                bookingId: form.bookingId,
                accepted: form.accepted,
                notes: form.notes,
                declarationVersion: form.declarationVersion,
                acceptedAt: form.acceptedAt,
                submittedAt: form.submittedAt,
                updatedAt: form.updatedAt,
                booking: bookingSummary(form.booking),
                revisionCount: Math.max(form._count.revisions, 1),
            })),
            ...members.map((row) => ({
                id: row.id,
                kind: "MEMBER",
                formId: null,
                userId: row.userId,
                fullName: row.user?.fullName ?? null,
                email: row.user?.email ?? null,
                phone: row.user?.phone ?? null,
                isGuest: false,
                bookingId: null,
                accepted: row.accepted,
                notes: row.notes,
                declarationVersion: row.declarationVersion,
                acceptedAt: row.acceptedAt,
                submittedAt: row.submittedAt,
                updatedAt: row.createdAt,
                booking: null,
                revisionCount: memberCountBy.get(row.userId) ?? 1,
            })),
        ].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || (a.id < b.id ? 1 : -1));
        const total = formTotal + members.length;
        const start = (filters.page - 1) * filters.limit;
        const totalPages = Math.max(Math.ceil(total / filters.limit), 1);
        return {
            declarations: records.slice(start, start + filters.limit),
            pagination: {
                page: filters.page,
                limit: filters.limit,
                total,
                totalPages,
                hasNextPage: filters.page < totalPages,
                hasPreviousPage: filters.page > 1,
            },
        };
    },
};
//# sourceMappingURL=health-safety.service.js.map