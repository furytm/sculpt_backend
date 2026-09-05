import scheduleService from "./schedule.service.js";
import { DayOfWeek } from "@prisma/client";
class ScheduleController {
    /**
     * GET /api/schedules
     */
    async getAllSchedules(req, res) {
        try {
            const schedules = await scheduleService.getAllSchedules();
            return res.status(200).json({
                success: true,
                data: {
                    schedules,
                },
            });
        }
        catch (error) {
            console.error("Get Schedules Error:", error);
            return res.status(500).json({
                success: false,
                message: error?.message || "Failed to retrieve schedules.",
            });
        }
    }
    /**
     * GET /api/schedules/day/:day
     */
    async getSchedulesByDay(req, res) {
        try {
            const day = String(req.params.day).toUpperCase();
            if (!Object.values(DayOfWeek).includes(day)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid day of week.",
                });
            }
            const schedules = await scheduleService.getSchedulesByDay(day);
            return res.status(200).json({
                success: true,
                data: {
                    schedules,
                },
            });
        }
        catch (error) {
            console.error("Get Schedules By Day Error:", error);
            return res.status(500).json({
                success: false,
                message: error?.message ||
                    "Failed to retrieve schedules.",
            });
        }
    }
    /**
   * GET /api/schedules/class/:classId
   *
   * Get all active schedules for a specific class.
   */
    async getSchedulesByClass(req, res) {
        try {
            const classId = String(req.params.classId).trim();
            if (!classId) {
                return res.status(400).json({
                    success: false,
                    message: "Class ID is required.",
                });
            }
            const schedules = await scheduleService.getSchedulesByClass(classId);
            return res.status(200).json({
                success: true,
                data: {
                    schedules,
                },
            });
        }
        catch (error) {
            console.error("Get Schedules By Class Error:", error);
            return res.status(500).json({
                success: false,
                message: error?.message ||
                    "Failed to retrieve class schedules.",
            });
        }
    }
}
export default new ScheduleController();
//# sourceMappingURL=schedule.controller.js.map