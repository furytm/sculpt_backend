import dotenv from "dotenv";
import membershipRoutes from "./membership/membership.route.js";
import express from "express";
import paymentRoutes from "./payment/payment.routes.js";import bookingRoutes from "./booking/booking.routes.js";
import cors from "cors";

console.log(
  "Membership router type:",
  typeof membershipRoutes,
  membershipRoutes
);
dotenv.config();

const app = express();

app.use(express.json());
// Middleware
app.use(
  cors({
    origin: "http://localhost:3000",
    
  })
);

app.use("/api/payments", paymentRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/memberships", membershipRoutes);
console.log(process.env.CLIENT_URL);

export default app;