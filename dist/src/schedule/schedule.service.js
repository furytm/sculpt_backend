import prisma from "../config/prisma.js";
class ScheduleService {
    /**
     * Get all active schedules.
     */
    async getAllSchedules() {
        return await prisma.schedule.findMany({
            where: {
                isActive: true,
            },
            orderBy: {
                createdAt: "asc",
            },
        });
    }
    /**
     * Get schedules for a specific day.
     */
    async getSchedulesByDay(dayOfWeek) {
        return await prisma.schedule.findMany({
            where: {
                dayOfWeek,
                isActive: true,
            },
            orderBy: {
                startTime: "asc",
            },
        });
    }
    /**
     * Get all active schedules for a specific class.
     */
    async getSchedulesByClass(classId) {
        return await prisma.schedule.findMany({
            where: {
                className: {
                    equals: classId,
                    mode: "insensitive",
                },
                isActive: true,
            },
            orderBy: [
                {
                    dayOfWeek: "asc",
                },
                {
                    startTime: "asc",
                },
            ],
        });
    }
}
export default new ScheduleService();
//# sourceMappingURL=schedule.service.js.map