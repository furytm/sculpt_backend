import prisma from "../config/prisma.js";
const GENERATION_DAYS = 30;
const DAY_OF_WEEK_MAP = {
    SUNDAY: 0,
    MONDAY: 1,
    TUESDAY: 2,
    WEDNESDAY: 3,
    THURSDAY: 4,
    FRIDAY: 5,
    SATURDAY: 6,
};
class ClassSessionService {
    /**
     * Generate future ClassSession records from the existing
     * recurring Schedule records.
     *
     * Sessions start from tomorrow and are generated for the
     * next 30 calendar days.
     */
    async generateFutureSessions(daysAhead = GENERATION_DAYS) {
        const schedules = await prisma.schedule.findMany({
            where: {
                isActive: true,
            },
        });
        if (schedules.length === 0) {
            console.log("ℹ️ No active schedules found.");
            return {
                schedulesProcessed: 0,
                sessionsCreated: 0,
                sessionsExisting: 0,
            };
        }
        const today = this.getLagosDate();
        // Tomorrow is the first selectable/bookable date.
        const tomorrow = new Date(today);
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
        let sessionsCreated = 0;
        let sessionsExisting = 0;
        for (const schedule of schedules) {
            const targetDay = DAY_OF_WEEK_MAP[schedule.dayOfWeek];
            if (targetDay === undefined) {
                console.warn(`⚠️ Unknown day of week for schedule ${schedule.id}: ${schedule.dayOfWeek}`);
                continue;
            }
            for (let offset = 0; offset < daysAhead; offset++) {
                const calendarDate = new Date(tomorrow);
                calendarDate.setUTCDate(tomorrow.getUTCDate() + offset);
                const currentDay = calendarDate.getUTCDay();
                // Only create a session when the calendar date
                // matches the recurring schedule's day.
                if (currentDay !== targetDay) {
                    continue;
                }
                const sessionDate = this.createSessionDate(calendarDate, schedule.startTime);
                const existingSession = await prisma.classSession.findUnique({
                    where: {
                        scheduleId_sessionDate: {
                            scheduleId: schedule.id,
                            sessionDate,
                        },
                    },
                });
                if (existingSession) {
                    sessionsExisting++;
                    continue;
                }
                await prisma.classSession.create({
                    data: {
                        scheduleId: schedule.id,
                        sessionDate,
                        capacity: schedule.capacity,
                        status: "OPEN",
                    },
                });
                sessionsCreated++;
                console.log(`✅ Created session: ${schedule.className} | ${schedule.dayOfWeek} | ${schedule.startTime} | ${this.formatDate(sessionDate)}`);
            }
        }
        console.log(`📅 Class session generation complete. Created: ${sessionsCreated}, Existing: ${sessionsExisting}`);
        return {
            schedulesProcessed: schedules.length,
            sessionsCreated,
            sessionsExisting,
        };
    }
    /**
     * Returns today's calendar date in Lagos time,
     * represented as a UTC date at midnight.
     *
     * Lagos is UTC+1 and does not use daylight saving time.
     */
    getLagosDate() {
        const now = new Date();
        const formatter = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Africa/Lagos",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        });
        const parts = formatter.formatToParts(now);
        const year = Number(parts.find((part) => part.type === "year")?.value);
        const month = Number(parts.find((part) => part.type === "month")?.value);
        const day = Number(parts.find((part) => part.type === "day")?.value);
        return new Date(Date.UTC(year, month - 1, day));
    }
    /**
     * Convert the schedule's local Lagos start time into
     * a Date stored in UTC.
     *
     * Supports:
     *   2:00 PM
     *   02:00 PM
     *   14:00
     *   14:00:00
     */
    createSessionDate(calendarDate, startTime) {
        const { hours, minutes } = this.parseTime(startTime);
        // Lagos = UTC+1.
        // Therefore 2:00 PM Lagos is stored as 1:00 PM UTC.
        return new Date(Date.UTC(calendarDate.getUTCFullYear(), calendarDate.getUTCMonth(), calendarDate.getUTCDate(), hours - 1, minutes, 0, 0));
    }
    /**
     * Parse a 12-hour or 24-hour time string.
     */
    parseTime(time) {
        const value = time.trim().toUpperCase();
        // 12-hour format:
        // 2:00 PM
        // 02:30 PM
        const twelveHourMatch = value.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
        if (twelveHourMatch) {
            let hours = Number(twelveHourMatch[1]);
            const minutes = Number(twelveHourMatch[2]);
            const period = twelveHourMatch[3];
            if (hours < 1 ||
                hours > 12 ||
                minutes < 0 ||
                minutes > 59) {
                throw new Error(`Invalid schedule time: ${time}`);
            }
            if (period === "AM") {
                if (hours === 12) {
                    hours = 0;
                }
            }
            else {
                if (hours !== 12) {
                    hours += 12;
                }
            }
            return {
                hours,
                minutes,
            };
        }
        // 24-hour format:
        // 14:00
        // 14:30
        // 14:00:00
        const twentyFourHourMatch = value.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
        if (twentyFourHourMatch) {
            const hours = Number(twentyFourHourMatch[1]);
            const minutes = Number(twentyFourHourMatch[2]);
            if (hours < 0 ||
                hours > 23 ||
                minutes < 0 ||
                minutes > 59) {
                throw new Error(`Invalid schedule time: ${time}`);
            }
            return {
                hours,
                minutes,
            };
        }
        throw new Error(`Invalid schedule time format: ${time}`);
    }
    formatDate(date) {
        return new Intl.DateTimeFormat("en-NG", {
            timeZone: "Africa/Lagos",
            dateStyle: "medium",
            timeStyle: "short",
        }).format(date);
    }
}
export default new ClassSessionService();
//# sourceMappingURL=class-session.service.js.map