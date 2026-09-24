import app from "./app.js";
import prisma from "./config/prisma.js";
import classSessionService from "./booking/class-session.service.js";

startServer();

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    await prisma.$connect();

    console.log("✅ Connected to PostgreSQL");

    // Generate missing future class sessions
    await classSessionService.generateFutureSessions();

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
}