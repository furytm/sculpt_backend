import dotenv from "dotenv";
import membershipRoutes from "./membership/membership.route.js";
import express from "express";
import paymentRoutes from "./payment/payment.routes.js";import bookingRoutes from "./booking/booking.routes.js";
import cors from "cors";


dotenv.config();

const app = express();

app.use(express.json());
// Middleware
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "https://sculpt-labs.vercel.app",
     " https://sculpt-lab-booking-flow-1.v0.build",
     "http://localhost:3001"
    ],
    credentials: true,
  })
);

app.use("/api/payments", paymentRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/memberships", membershipRoutes);


export default app;