import { Router } from "express";
import bookingController from "./booking.controller.js";

const router = Router();

router.post("/", bookingController.createBooking);
router.get(
    "/confirmation/:reference",
    bookingController.getBookingConfirmation
);

router.get("/:bookingId", bookingController.getBooking);

export default router;