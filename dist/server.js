import app from "./app.js";
import prisma from "./config/prisma.js";
import classSessionService from "./booking/class-session.service.js";
import { healthRouter } from "./modules/health/health.route.js";
import { scheduleDailySessionGeneration } from "./booking/session-generation.scheduler.js";
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
        // Graceful shutdown.
        const shutdown = async () => {
            console.log("Shutting down server...");
            dailySessionGeneration.stop();
            server.close(async () => {
                await prisma.$disconnect();
                process.exit(0);
            });
        };
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