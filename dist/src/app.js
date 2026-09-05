import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import membershipRoutes from "./membership/membership.route.js";
import paymentRoutes from "./payment/payment.routes.js";
import bookingRoutes from "./booking/booking.routes.js";
import authRoutes from "./auth/auth.routes.js";
import scheduleRoutes from "./schedule/schedule.routes.js";
import swaggerUi from "swagger-ui-express";
import swaggerSpec from "./config/swagger.js";
dotenv.config();
const app = express();
app.use(express.json());
// Swagger MUST have /api-docs here
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use(cookieParser());
// CORS
app.use(cors({
    origin: true,
    credentials: true,
}));
// Routes
app.use("/api/auth", authRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/memberships", membershipRoutes);
app.use("/api/schedules", scheduleRoutes);
export default app;
//# sourceMappingURL=app.js.map