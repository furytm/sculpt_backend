import prisma from "../config/prisma.js";
class AdminSessionService {
    /**
     * Get class sessions for admin management.
     *
     * By default returns upcoming sessions.
     */
    async getSessions(options) {
        const now = new Date();
        const fromDate = options?.fromDate ?? now;
        const sessions = await prisma.classSession.findMany({
            where: {
                sessionDate: {
                    gte: fromDate,
                    ...(options?.toDate
                        ? {
                            lte: options.toDate,
                        }
                        : {}),
                },
                ...(options?.status
                    ? {
                        status: options.status,
                    }
                    : {}),
                ...(options?.classId
                    ? {
                        schedule: {
                            className: {
                                equals: options.classId,
                                mode: "insensitive",
                            },
                        },
                    }
                    : {}),
            },
            include: {
                schedule: true,
                bookings: {
                    where: {
                        bookingStatus: "CONFIRMED",
                    },
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                        phone: true,
                        bookingStatus: true,
                        paymentStatus: true,
                        userId: true,
                        memberMembershipId: true,
                        createdAt: true,
                    },
                },
                _count: {
                    select: {
                        bookings: {
                            where: {
                                bookingStatus: "CONFIRMED",
                            },
                        },
                    },
                },
            },
            orderBy: {
                sessionDate: "asc",
            },
        });
        return sessions.map((session) => {
            const capacity = session.capacity ?? session.schedule.capacity;
            const bookedCount = session._count.bookings;
            const availableSlots = Math.max(capacity - bookedCount, 0);
            return {
                id: session.id,
                classId: session.schedule.className,
                className: session.schedule.className,
                tutorName: session.schedule.tutorName,
                code: session.schedule.code,
                sessionDate: session.sessionDate,
                dayOfWeek: session.schedule.dayOfWeek,
                startTime: session.schedule.startTime,
                endTime: session.schedule.endTime,
                capacity,
                bookedCount,
                availableSlots,
                status: session.status,
                isAvailable: session.status === "OPEN" &&
                    availableSlots > 0,
                bookings: session.bookings,
                createdAt: session.createdAt,
                updatedAt: session.updatedAt,
            };
        });
    }
    /**
     * Get one session with its bookings.
     */
    async getSessionById(sessionId) {
        const session = await prisma.classSession.findUnique({
            where: {
                id: sessionId,
            },
            include: {
                schedule: true,
                bookings: {
                    where: {
                        bookingStatus: "CONFIRMED",
                    },
                    orderBy: {
                        createdAt: "asc",
                    },
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                        phone: true,
                        bookingStatus: true,
                        paymentStatus: true,
                        userId: true,
                        memberMembershipId: true,
                        createdAt: true,
                    },
                },
                _count: {
                    select: {
                        bookings: {
                            where: {
                                bookingStatus: "CONFIRMED",
                            },
                        },
                    },
                },
            },
        });
        if (!session) {
            throw new Error("Class session not found.");
        }
        const capacity = session.capacity ?? session.schedule.capacity;
        const bookedCount = session._count.bookings;
        const availableSlots = Math.max(capacity - bookedCount, 0);
        return {
            id: session.id,
            classId: session.schedule.className,
            className: session.schedule.className,
            tutorName: session.schedule.tutorName,
            code: session.schedule.code,
            sessionDate: session.sessionDate,
            dayOfWeek: session.schedule.dayOfWeek,
            startTime: session.schedule.startTime,
            endTime: session.schedule.endTime,
            capacity,
            bookedCount,
            availableSlots,
            status: session.status,
            isAvailable: session.status === "OPEN" &&
                availableSlots > 0,
            bookings: session.bookings,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
        };
    }
    /**
     * Cancel an upcoming class session.
     *
     * We do NOT delete the session because the session record
     * is useful for historical/reference purposes.
     */
    async cancelSession(sessionId) {
        const session = await prisma.classSession.findUnique({
            where: {
                id: sessionId,
            },
            include: {
                schedule: true,
                bookings: {
                    where: {
                        bookingStatus: "CONFIRMED",
                    },
                },
            },
        });
        if (!session) {
            throw new Error("Class session not found.");
        }
        if (session.sessionDate <= new Date()) {
            throw new Error("A session that has already started cannot be cancelled.");
        }
        if (session.status === "COMPLETED") {
            throw new Error("A completed session cannot be cancelled.");
        }
        if (session.status === "CANCELLED") {
            throw new Error("This session is already cancelled.");
        }
        const updatedSession = await prisma.$transaction(async (tx) => {
            /**
             * Cancel the session.
             */
            const updated = await tx.classSession.update({
                where: {
                    id: sessionId,
                },
                data: {
                    status: "CANCELLED",
                },
            });
            /**
             * Cancel all confirmed bookings attached
             * to this session.
             *
             * NOTE:
             * We restore member credits here because the
             * class itself was cancelled by the studio.
             */
            for (const booking of session.bookings) {
                await tx.booking.update({
                    where: {
                        id: booking.id,
                    },
                    data: {
                        bookingStatus: "CANCELLED",
                    },
                });
                if (booking.memberMembershipId) {
                    const memberMembership = await tx.memberMembership.findUnique({
                        where: {
                            id: booking.memberMembershipId,
                        },
                    });
                    if (memberMembership &&
                        memberMembership.creditsTotal !== null &&
                        memberMembership.creditsUsed > 0) {
                        await tx.memberMembership.update({
                            where: {
                                id: memberMembership.id,
                            },
                            data: {
                                creditsUsed: {
                                    decrement: 1,
                                },
                            },
                        });
                    }
                }
            }
            return updated;
        });
        return {
            message: "Class session cancelled successfully.",
            session: updatedSession,
            cancelledBookings: session.bookings.length,
            creditsRestored: session.bookings.filter((booking) => booking.memberMembershipId !== null).length,
        };
    }
    /**
     * Reopen a cancelled session.
     *
     * Only use this when the studio wants the session
     * to become bookable again.
     */
    async reopenSession(sessionId) {
        const session = await prisma.classSession.findUnique({
            where: {
                id: sessionId,
            },
        });
        if (!session) {
            throw new Error("Class session not found.");
        }
        if (session.status !== "CANCELLED") {
            throw new Error("Only cancelled sessions can be reopened.");
        }
        if (session.sessionDate <= new Date()) {
            throw new Error("A session that has already started cannot be reopened.");
        }
        const updatedSession = await prisma.classSession.update({
            where: {
                id: sessionId,
            },
            data: {
                status: "OPEN",
            },
        });
        return {
            message: "Class session reopened successfully.",
            session: updatedSession,
        };
    }
}
export default new AdminSessionService();
//# sourceMappingURL=admin-session.service.js.map