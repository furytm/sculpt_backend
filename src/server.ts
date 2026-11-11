import app from "./app.js";
import prisma from "./config/prisma.js";
import classSessionService from "./booking/class-session.service.js";
import { scheduleDailySessionGeneration } from "./booking/session-generation.scheduler.js";

startServer();

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    await prisma.$connect();

    console.log("✅ Connected to PostgreSQL");

    // Generate missing future class sessions
    await classSessionService.generateFutureSessions();

    const server = app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });

    // Keep the rolling 30-day window of sessions moving forward while
    // the server stays up: re-run the same generator every 24 hours.
    const dailySessionGeneration = scheduleDailySessionGeneration(() =>
      classSessionService.generateFutureSessions()
    );

    // Graceful shutdown: stop the daily job, stop accepting requests,
    // then disconnect from the database.
    const shutdown = (signal: string) => {
      console.log(`🛑 ${signal} received. Shutting down...`);

      dailySessionGeneration.stop();

      // Don't wait forever for open connections to close.
      setTimeout(() => process.exit(0), 10_000).unref();

      server.close(() => {
        prisma
          .$disconnect()
          .catch((error) => console.error("❌ Prisma disconnect failed:", error))
          .finally(() => process.exit(0));
      });
    };

    process.once("SIGTERM", () => shutdown("SIGTERM"));
    process.once("SIGINT", () => shutdown("SIGINT"));
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
}
