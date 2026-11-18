import app from "./app.js";
import prisma from "./config/prisma.js";
import classSessionService from "./booking/class-session.service.js";
import { healthRouter } from "./modules/health/health.route.js";
import { scheduleDailySessionGeneration } from "./booking/session-generation.scheduler.js";
import { createGracefulShutdown } from "./lifecycle/graceful-shutdown.js";
import activityLog from "./activity-log/activity-log.service.js";
app.use(healthRouter);
startServer();
const PORT = process.env.PORT || 5000;
async function startServer() {
    try {
        await prisma.$connect();
        console.log("✅ Connected to PostgreSQL");
        // Generate missing future class sessions on startup.
        await classSessionService.generateFutureSessions();
        const server = app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
        });
        // Keep the rolling session window updated every 24 hours.
        const dailySessionGeneration = scheduleDailySessionGeneration(() => classSessionService.generateFutureSessions());
        // Graceful shutdown: stop jobs, finish active requests, flush the
        // activity log (bounded), then disconnect Prisma.
        const shutdown = createGracefulShutdown({
            server,
            stopJobs: () => dailySessionGeneration.stop(),
            flushActivityLog: (timeoutMs) => activityLog.flush(timeoutMs),
            disconnect: () => prisma.$disconnect(),
            exit: (code) => process.exit(code),
        });
        process.on("SIGTERM", shutdown);
        process.on("SIGINT", shutdown);
    }
    catch (error) {
        console.error("❌ Failed to start server:", error);
        await prisma.$disconnect();
        process.exit(1);
    }
}
//# sourceMappingURL=server.js.map