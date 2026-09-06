import { Router } from "express";
import scheduleController from "./schedule.controller.js";
const router = Router();
/**
 * @swagger
 * /api/schedules:
 *   get:
 *     summary: Get all active class schedules
 *     tags:
 *       - Schedules
 *     responses:
 *       200:
 *         description: Successfully retrieved schedules
 *       500:
 *         description: Failed to retrieve schedules
 */
router.get("/", scheduleController.getAllSchedules);
/**
 * @swagger
 * /api/schedules/class/{classId}:
 *   get:
 *     summary: Get schedules for a specific class
 *     tags:
 *       - Schedules
 *     parameters:
 *       - in: path
 *         name: classId
 *         required: true
 *         schema:
 *           type: string
 *         description: The class ID or class identifier
 *     responses:
 *       200:
 *         description: Successfully retrieved class schedules
 *       400:
 *         description: Class ID is required
 *       500:
 *         description: Failed to retrieve class schedules
 */
router.get("/class/:classId", scheduleController.getSchedulesByClass);
/**
 * @swagger
 * /api/schedules/day/{day}:
 *   get:
 *     summary: Get schedules for a specific day
 *     tags:
 *       - Schedules
 *     parameters:
 *       - in: path
 *         name: day
 *         required: true
 *         schema:
 *           type: string
 *           enum:
 *             - MONDAY
 *             - TUESDAY
 *             - WEDNESDAY
 *             - THURSDAY
 *             - FRIDAY
 *             - SATURDAY
 *             - SUNDAY
 *     responses:
 *       200:
 *         description: Successfully retrieved schedules
 *       400:
 *         description: Invalid day of week
 *       500:
 *         description: Failed to retrieve schedules
 */
router.get("/day/:day", scheduleController.getSchedulesByDay);
export default router;
//# sourceMappingURL=schedule.routes.js.map