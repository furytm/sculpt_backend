import app from "./app.js";
import prisma from "./config/prisma.js";
startServer();
const PORT = process.env.PORT || 5000;
async function startServer() {
    try {
        await prisma.$connect();
        console.log("✅ Connected to PostgreSQL");
        app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
        });
        //  console.dir(app.router.stack, { depth: 10 });
    }
    catch (error) {
        console.error("❌ Failed to connect to PostgreSQL:", error);
        process.exit(1);
    }
}
//# sourceMappingURL=server.js.map