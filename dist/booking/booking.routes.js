import { Router } from "express";
import bookingController from "./booking.controller.js";
import authenticate from "../middleware/authenticate.js";
const router = Router();
// =========================================================
// CREATE BOOKING
// =========================================================
router.post("/", bookingController.createBooking);
// =========================================================
// AVAILABILITY
// =========================================================
// Get all available dated sessions for a class
//
// Example:
// GET /api/bookings/availability/reformer
//
// Optional:
// ?startDate=2026-09-24
// ?endDate=2026-10-24
router.get("/availability/:classId", bookingController.getClassAvailability);
// Get availability for one specific dated session
router.get("/sessions/:sessionId", bookingController.getSessionAvailability);
// =========================================================
// PAYMENT
// =========================================================
// Initialize Paymish payment for an existing booking
router.post("/:bookingId/payment", bookingController.initializePayment);
// =========================================================
// HEALTH DECLARATION
// =========================================================
router.patch("/:bookingId/health-declaration", bookingController.saveHealthDeclaration);
// =========================================================
// ATTACH BOOKING TO ACCOUNT
// =========================================================
router.post("/:bookingId/attach-account", authenticate, bookingController.attachBookingAccount);
// =========================================================
// CONFIRM BOOKING
// =========================================================
router.post("/:bookingId/confirm", authenticate, bookingController.confirmBooking);
// =========================================================
// BOOK SESSION WITH EXISTING MEMBERSHIP
// =========================================================
router.post("/member-session", authenticate, bookingController.bookMemberSession);
// =========================================================
// MEMBERSHIP CREDITS
// =========================================================
router.get("/my/credits", authenticate, bookingController.getMembershipCreditSummary);
router.post("/:bookingId/cancel", authenticate, bookingController.cancelBooking);
// =========================================================
// BOOKING CONFIRMATION
// =========================================================
// Public lookup by Paymish payment reference
router.get("/confirmation/:reference", bookingController.getBookingConfirmation);
// Continue a guest booking after payment
router.get("/confirmation/:reference/continue", bookingController.continueGuestBooking);
// =========================================================
// AUTHENTICATED MEMBER BOOKINGS
// =========================================================
//
// IMPORTANT:
// /my must come before /:bookingId
// =========================================================
router.get("/my", authenticate, bookingController.getMyBookings);
// =========================================================
// SINGLE BOOKING
// =========================================================
router.get("/:bookingId", bookingController.getBooking);
export default router;
//# sourceMappingURL=booking.routes.js.map