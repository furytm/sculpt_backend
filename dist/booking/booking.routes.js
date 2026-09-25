import { Router } from "express";
import bookingController from "./booking.controller.js";
import authenticate from "../middleware/authenticate.js";
const router = Router();
// =========================================================
// CREATE BOOKING
// =========================================================
/**
 * @openapi
 * /api/bookings:
 *   post:
 *     tags:
 *       - Booking
 *     summary: Create a new booking
 *     description: Creates a booking for a selected membership and, for group classes, a specific available class session.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - fullName
 *               - email
 *               - phone
 *               - membershipId
 *             properties:
 *               fullName:
 *                 type: string
 *                 example: Test Member
 *               email:
 *                 type: string
 *                 format: email
 *                 example: test@example.com
 *               phone:
 *                 type: string
 *                 example: "08012345678"
 *               membershipId:
 *                 type: string
 *                 example: single-class
 *               classSessionId:
 *                 type: string
 *                 nullable: true
 *                 description: Required for group bookings.
 *                 example: clx123456789
 *               healthDeclaration:
 *                 type: object
 *                 nullable: true
 *                 description: Health and safety declaration submitted during booking.
 *                 properties:
 *                   accepted:
 *                     type: boolean
 *                     example: true
 *     responses:
 *       201:
 *         description: Booking created successfully
 *       400:
 *         description: Invalid booking details or unavailable session
 *       404:
 *         description: Membership or class session not found
 */
router.post("/", bookingController.createBooking);
// =========================================================
// AVAILABILITY
// =========================================================
/**
 * @openapi
 * /api/bookings/availability/{classId}:
 *   get:
 *     tags:
 *       - Booking
 *     summary: Get available sessions for a class
 *     description: Returns available dated class sessions for the selected class. Sessions begin from tomorrow onward.
 *     parameters:
 *       - in: path
 *         name: classId
 *         required: true
 *         schema:
 *           type: string
 *         description: Class ID
 *         example: reformer
 *       - in: query
 *         name: startDate
 *         required: false
 *         schema:
 *           type: string
 *           format: date
 *         description: Optional start date for the availability range.
 *         example: "2026-09-25"
 *       - in: query
 *         name: endDate
 *         required: false
 *         schema:
 *           type: string
 *           format: date
 *         description: Optional end date for the availability range.
 *         example: "2026-10-24"
 *     responses:
 *       200:
 *         description: Class availability returned successfully
 *       400:
 *         description: Invalid date range or class ID
 *       404:
 *         description: Class not found
 */
router.get("/availability/:classId", bookingController.getClassAvailability);
/**
 * @openapi
 * /api/bookings/sessions/{sessionId}:
 *   get:
 *     tags:
 *       - Booking
 *     summary: Get availability for a specific session
 *     description: Returns the availability and booking capacity information for one dated class session.
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Class session ID
 *         example: clx123456789
 *     responses:
 *       200:
 *         description: Session availability returned successfully
 *       404:
 *         description: Session not found
 */
router.get("/sessions/:sessionId", bookingController.getSessionAvailability);
// =========================================================
// PAYMENT
// =========================================================
/**
 * @openapi
 * /api/bookings/{bookingId}/payment:
 *   post:
 *     tags:
 *       - Booking
 *       - Payment
 *     summary: Initialize payment for a booking
 *     description: Initializes a Paymish payment for an existing booking and returns the payment authorization URL.
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *         description: Booking ID
 *         example: clx123456789
 *     responses:
 *       200:
 *         description: Payment initialized successfully
 *       400:
 *         description: Payment could not be initialized
 *       404:
 *         description: Booking not found
 */
router.post("/:bookingId/payment", bookingController.initializePayment);
// =========================================================
// HEALTH DECLARATION
// =========================================================
/**
 * @openapi
 * /api/bookings/{bookingId}/health-declaration:
 *   patch:
 *     tags:
 *       - Booking
 *     summary: Save health and safety declaration
 *     description: Saves the member's health and safety declaration for a booking.
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *         description: Booking ID
 *         example: clx123456789
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - accepted
 *             properties:
 *               accepted:
 *                 type: boolean
 *                 example: true
 *     responses:
 *       200:
 *         description: Health declaration saved successfully
 *       400:
 *         description: Invalid health declaration
 *       404:
 *         description: Booking not found
 */
router.patch("/:bookingId/health-declaration", bookingController.saveHealthDeclaration);
// =========================================================
// ATTACH BOOKING TO ACCOUNT
// =========================================================
/**
 * @openapi
 * /api/bookings/{bookingId}/attach-account:
 *   post:
 *     tags:
 *       - Booking
 *     summary: Attach a booking to the authenticated account
 *     description: Links an existing guest booking to the authenticated member account.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *         description: Booking ID
 *         example: clx123456789
 *     responses:
 *       200:
 *         description: Booking attached to account successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Booking not found
 */
router.post("/:bookingId/attach-account", authenticate, bookingController.attachBookingAccount);
// =========================================================
// CONFIRM BOOKING
// =========================================================
/**
 * @openapi
 * /api/bookings/{bookingId}/confirm:
 *   post:
 *     tags:
 *       - Booking
 *     summary: Confirm a paid booking
 *     description: Confirms a paid booking after the member has authenticated. For group bookings, this also reserves the selected class session and applies the membership credit.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *         description: Booking ID
 *         example: clx123456789
 *     responses:
 *       200:
 *         description: Booking confirmed successfully
 *       400:
 *         description: Booking is not ready for confirmation
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Booking not found
 */
router.post("/:bookingId/confirm", authenticate, bookingController.confirmBooking);
// =========================================================
// BOOK SESSION WITH EXISTING MEMBERSHIP
// =========================================================
/**
 * @openapi
 * /api/bookings/member-session:
 *   post:
 *     tags:
 *       - Booking
 *     summary: Book a session using an existing membership
 *     description: Allows an authenticated member with an active membership and available credit to book a future class session.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sessionId
 *             properties:
 *               sessionId:
 *                 type: string
 *                 description: Class session ID
 *                 example: clx123456789
 *     responses:
 *       201:
 *         description: Session booked successfully
 *       400:
 *         description: Membership credit unavailable or session unavailable
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Session or membership not found
 */
router.post("/member-session", authenticate, bookingController.bookMemberSession);
// =========================================================
// MEMBERSHIP CREDITS
// =========================================================
/**
 * @openapi
 * /api/bookings/my/credits:
 *   get:
 *     tags:
 *       - Booking
 *       - Membership
 *     summary: Get membership credit summary
 *     description: Returns the authenticated member's active membership and remaining booking credits.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Membership credit summary returned successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: No active membership found
 */
router.get("/my/credits", authenticate, bookingController.getMembershipCreditSummary);
// =========================================================
// CANCEL BOOKING
// =========================================================
/**
 * @openapi
 * /api/bookings/{bookingId}/cancel:
 *   post:
 *     tags:
 *       - Booking
 *     summary: Cancel a booking
 *     description: Cancels a future booking and restores one membership credit when applicable.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *         description: Booking ID
 *         example: clx123456789
 *     responses:
 *       200:
 *         description: Booking cancelled successfully
 *       400:
 *         description: Booking cannot be cancelled
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Booking not found
 */
router.post("/:bookingId/cancel", authenticate, bookingController.cancelBooking);
// =========================================================
// BOOKING CONFIRMATION
// =========================================================
/**
 * @openapi
 * /api/bookings/confirmation/{reference}:
 *   get:
 *     tags:
 *       - Booking
 *     summary: Get booking confirmation
 *     description: Retrieves booking confirmation information using the Paymish payment reference.
 *     parameters:
 *       - in: path
 *         name: reference
 *         required: true
 *         schema:
 *           type: string
 *         description: Paymish payment reference
 *         example: SL-1788605831326
 *     responses:
 *       200:
 *         description: Booking confirmation returned successfully
 *       404:
 *         description: Booking not found
 */
router.get("/confirmation/:reference", bookingController.getBookingConfirmation);
/**
 * @openapi
 * /api/bookings/confirmation/{reference}/continue:
 *   get:
 *     tags:
 *       - Booking
 *     summary: Continue a guest booking after payment
 *     description: Retrieves a paid guest booking so the customer can continue with account registration or login.
 *     parameters:
 *       - in: path
 *         name: reference
 *         required: true
 *         schema:
 *           type: string
 *         description: Paymish payment reference
 *         example: SL-1788605831326
 *     responses:
 *       200:
 *         description: Guest booking retrieved successfully
 *       404:
 *         description: Booking not found
 */
router.get("/confirmation/:reference/continue", bookingController.continueGuestBooking);
// =========================================================
// AUTHENTICATED MEMBER BOOKINGS
// =========================================================
//
// IMPORTANT:
// /my must come before /:bookingId
// =========================================================
/**
 * @openapi
 * /api/bookings/my:
 *   get:
 *     tags:
 *       - Booking
 *     summary: Get the authenticated member's bookings
 *     description: Returns bookings belonging to the authenticated member.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Member bookings returned successfully
 *       401:
 *         description: Unauthorized
 */
router.get("/my", authenticate, bookingController.getMyBookings);
// =========================================================
// SINGLE BOOKING
// =========================================================
/**
 * @openapi
 * /api/bookings/{bookingId}:
 *   get:
 *     tags:
 *       - Booking
 *     summary: Get a single booking
 *     description: Retrieves a booking by its ID.
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *         description: Booking ID
 *         example: clx123456789
 *     responses:
 *       200:
 *         description: Booking returned successfully
 *       404:
 *         description: Booking not found
 */
router.get("/:bookingId", bookingController.getBooking);
export default router;
//# sourceMappingURL=booking.routes.js.map