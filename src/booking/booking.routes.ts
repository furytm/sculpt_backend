import { Router } from "express";
import bookingController from "./booking.controller.js";
import authenticate from "../middleware/authenticate.js";

const router = Router();
/**
 * @swagger
 * /api/bookings:
 *   post:
 *     summary: Create a new booking
 *     tags:
 *       - Bookings
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
 *               - paymentMethod
 *             properties:
 *               fullName:
 *                 type: string
 *                 example: Test User
 *               email:
 *                 type: string
 *                 format: email
 *                 example: test@example.com
 *               phone:
 *                 type: string
 *                 example: "08012345678"
 *               membershipId:
 *                 type: string
 *                 example: cmxxxxxxxx
 *               classId:
 *                 type: string
 *                 example: cmxxxxxxxx
 *               scheduleId:
 *                 type: string
 *                 example: cmxxxxxxxx
 *               bookingDate:
 *                 type: string
 *                 format: date-time
 *                 example: "2026-09-21T00:00:00.000Z"
 *               paymentMethod:
 *                 type: string
 *                 enum:
 *                   - PAYMISH
 *                   - OFFLINE
 *                 example: OFFLINE
 *     responses:
 *       201:
 *         description: Booking created successfully
 *       400:
 *         description: Invalid booking data
 *       404:
 *         description: Membership or class not found
 *       500:
 *         description: Server error
 */
router.post("/", bookingController.createBooking);

/**
 * @swagger
 * /api/bookings/{bookingId}/health-declaration:
 *   patch:
 *     summary: Submit booking health declaration
 *     description: |
 *       Saves the customer's Health Declaration before account creation.
 *       This endpoint is protected by the temporary bookingFlowToken.
 *     tags:
 *       - Bookings
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *         description: The booking ID returned when the booking was created.
 *         example: cmxxxxxxxx
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - bookingFlowToken
 *               - accepted
 *             properties:
 *               bookingFlowToken:
 *                 type: string
 *                 description: Temporary token returned by POST /api/bookings.
 *                 example: 7f6c4a1b2c3d4e5f6a7b8c9d
 *               accepted:
 *                 type: boolean
 *                 description: Must be true to continue the booking flow.
 *                 example: true
 *               notes:
 *                 type: string
 *                 nullable: true
 *                 description: Optional health information the customer wants Sculpt LAB to know.
 *                 example: No injuries or medical conditions to report.
 *     responses:
 *       200:
 *         description: Health Declaration saved successfully.
 *       400:
 *         description: Invalid request or declaration not accepted.
 *       404:
 *         description: Booking not found.
 */
router.patch(
  "/:bookingId/health-declaration",
  bookingController.saveHealthDeclaration
);
/**
 * @swagger
 * /api/bookings/{bookingId}/schedule:
 *   patch:
 *     summary: Select a recurring class schedule
 *     description: |
 *       Selects the specific recurring class schedule the customer wants.
 *       The bookingFlowToken is used instead of requiring an account.
 *     tags:
 *       - Bookings
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *         description: The booking ID.
 *         example: cmxxxxxxxx
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - bookingFlowToken
 *               - scheduleId
 *             properties:
 *               bookingFlowToken:
 *                 type: string
 *                 description: Temporary token returned by POST /api/bookings.
 *                 example: 7f6c4a1b2c3d4e5f6a7b8c9d
 *               scheduleId:
 *                 type: string
 *                 description: ID of the recurring Schedule selected by the customer.
 *                 example: cmxxxxxxxx
 *     responses:
 *       200:
 *         description: Schedule selected successfully.
 *       400:
 *         description: Invalid schedule or booking flow token.
 *       404:
 *         description: Booking or schedule not found.
 */
router.patch(
  "/:bookingId/schedule",
  bookingController.updateBookingSchedule
);

/**
 * @swagger
 * /api/bookings/{bookingId}/start-date:
 *   patch:
 *     summary: Select membership start date
 *     description: |
 *       Saves the date the customer's membership should begin.
 *       This endpoint is used before account creation and is protected
 *       by the temporary bookingFlowToken.
 *     tags:
 *       - Bookings
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *         description: The booking ID.
 *         example: cmxxxxxxxx
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - bookingFlowToken
 *               - startDate
 *             properties:
 *               bookingFlowToken:
 *                 type: string
 *                 description: Temporary token returned by POST /api/bookings.
 *                 example: 7f6c4a1b2c3d4e5f6a7b8c9d
 *               startDate:
 *                 type: string
 *                 format: date
 *                 description: Membership start date.
 *                 example: "2026-09-21"
 *     responses:
 *       200:
 *         description: Start date saved successfully.
 *       400:
 *         description: Invalid start date or booking flow token.
 *       404:
 *         description: Booking not found.
 */
router.patch(
  "/:bookingId/start-date",
  bookingController.updateBookingStartDate
);

/**
 * @swagger
 * /api/bookings/{bookingId}/attach-account:
 *   post:
 *     summary: Attach booking to authenticated account
 *     description: |
 *       Connects the existing pre-account booking to the authenticated
 *       customer's account after Health Declaration, schedule and start
 *       date have been completed.
 *     tags:
 *       - Bookings
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *         description: The booking ID.
 *         example: cmxxxxxxxx
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - bookingFlowToken
 *             properties:
 *               bookingFlowToken:
 *                 type: string
 *                 description: Temporary token returned by POST /api/bookings.
 *                 example: 7f6c4a1b2c3d4e5f6a7b8c9d
 *     responses:
 *       200:
 *         description: Booking successfully attached to the account.
 *       401:
 *         description: Authentication required.
 *       400:
 *         description: Invalid booking flow token.
 *       404:
 *         description: Booking not found.
 */
router.post(
  "/:bookingId/attach-account",
  authenticate,
  bookingController.attachBookingAccount
);

/**
 * @swagger
 * /api/bookings/{bookingId}/confirm:
 *   post:
 *     summary: Confirm booking
 *     description: |
 *       Finalizes the booking after payment, Health Declaration,
 *       schedule and start date have been completed.
 *
 *       The service re-checks schedule capacity inside a database
 *       transaction before creating the MemberSchedule and confirming
 *       the booking.
 *     tags:
 *       - Bookings
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *         description: The booking ID.
 *         example: cmxxxxxxxx
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               bookingFlowToken:
 *                 type: string
 *                 description: Temporary booking flow token.
 *                 example: 7f6c4a1b2c3d4e5f6a7b8c9d
 *     responses:
 *       200:
 *         description: Booking confirmed successfully.
 *       400:
 *         description: Booking is missing payment, health declaration, schedule or start date.
 *       401:
 *         description: Authentication required.
 *       409:
 *         description: Schedule capacity has been reached.
 *       404:
 *         description: Booking not found.
 */
router.post(
  "/:bookingId/confirm",
  authenticate,
  bookingController.confirmBooking
);

/**
 * =========================================================
 * BOOKING INFORMATION
 * =========================================================
 */

/**
 * Public booking lookup by payment reference.
 *
 * Used after Paymish redirects the customer back to
 * Sculpt LAB.
 */
router.get(
  "/confirmation/:reference",
  bookingController.getBookingConfirmation
);


/**
 * =========================================================
 * CONTINUE GUEST BOOKING
 * =========================================================
 *
 * Public endpoint used after Paymish redirects the customer
 * back to Sculpt LAB with the payment reference.
 *
 * Creates a fresh booking continuation token.
 */
router.get(
  "/confirmation/:reference/continue",
  bookingController.continueGuestBooking
);
/**
 * Get a single booking.
 *
 * Keep this public because the booking flow exists
 * before account creation.
 */
router.get(
  "/:bookingId",
  bookingController.getBooking
);

/**
 * =========================================================
 * AUTHENTICATED MEMBER BOOKINGS
 * =========================================================
 *
 * IMPORTANT:
 * This must remain before /:bookingId.
 */
router.get(
  "/my",
  authenticate,
  bookingController.getMyBookings
);

/**
 * =========================================================
 * LEGACY ROUTES
 * =========================================================
 *
 * These belong to the OLD booking flow.
 *
 * Keep them temporarily so we don't break existing
 * frontend code while migrating the booking flow.
 *
 * They should eventually be removed after the new
 * frontend is fully connected.
 */

/**
 * OLD:
 * Update class after payment
 */
router.patch(
  "/:bookingId/class",
  authenticate,
  bookingController.updateBookingClass
);

/**
 * OLD:
 * Save class preferences
 */
router.patch(
  "/:bookingId/preferences",
  authenticate,
  bookingController.updateBookingPreferences
);

/**
 * OLD:
 * Assign ALL schedules for a class.
 *
 * DO NOT use this in the new frontend.
 *
 * The new flow selects ONE recurring schedule.
 */
router.post(
  "/:bookingId/assign-schedules",
  authenticate,
  bookingController.assignSchedules
);

/**
 * OLD health-safety endpoint.
 *
 * Kept temporarily for backwards compatibility.
 *
 * New frontend should use:
 * PATCH /:bookingId/health-declaration
 */
router.patch(
  "/:bookingId/health-safety",
  authenticate,
  bookingController.saveHealthSafetyForm
);

export default router;