import { Router } from "express";
import bookingController from "./booking.controller.js";
import authenticate from "../middleware/authenticate.js";

const router = Router();

router.post(
  "/",
  bookingController.createBooking
);

router.patch(
  "/:bookingId/schedule",
  authenticate,
  bookingController.updateBookingSchedule
);

router.patch(
  "/:bookingId/start-date",
  authenticate,
  bookingController.updateBookingStartDate
);
router.patch(
  "/:bookingId/preferences",
  authenticate,
  bookingController.updateBookingPreferences
);

router.patch(
  "/:bookingId/health-safety",
  authenticate,
  bookingController.saveHealthSafetyForm
);
router.post(
  "/:bookingId/confirm",
  authenticate,
  bookingController.confirmBooking
);

router.get(
  "/confirmation/:reference",
  bookingController.getBookingConfirmation
);



/**
 * Authenticated member bookings
 *
 * IMPORTANT:
 * This must come before /:bookingId
 */
router.get(
  "/my",
  authenticate,
  bookingController.getMyBookings
);

router.get(
  "/:bookingId",
  bookingController.getBooking
);

export default router;