import { Router } from "express";
import authenticate from "../middleware/authenticate.js";
import requireAdmin from "../middleware/requireAdmin.js";
import { adminController } from "./admin.controller.js";
import adminSessionController from "./admin-session.controller.js";
const router = Router();
console.log("🔥 ADMIN ROUTES LOADED");
// =====================================================
// TEST MEMBERSHIP ACTIVATION SERVICE
// =====================================================
/**
 * @openapi
 * /api/admin/payments/test-activation-service:
 *   get:
 *     tags:
 *       - Admin
 *     summary: Test membership activation service
 *     description: Test endpoint used to verify that the membership activation service is available.
 *     responses:
 *       200:
 *         description: Test route works successfully
 */
router.get("/payments/test-activation-service", (_req, res) => {
    console.log("🔥🔥🔥 TEST ACTIVATION ROUTE HIT 🔥🔥🔥");
    return res.json({
        success: true,
        message: "TEST ROUTE WORKS",
    });
});
// =====================================================
// DASHBOARD
// =====================================================
/**
 * @openapi
 * /api/admin/dashboard:
 *   get:
 *     tags:
 *       - Admin
 *     summary: Get admin dashboard
 *     description: Returns dashboard statistics for administrators.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard data returned successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.get("/dashboard", authenticate, requireAdmin, adminController.getDashboard);
// =====================================================
// PENDING OFFLINE PAYMENTS
// =====================================================
/**
 * @openapi
 * /api/admin/payments/pending:
 *   get:
 *     tags:
 *       - Admin
 *     summary: Get pending offline payments
 *     description: Returns bookings awaiting administrator confirmation of offline payment.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Pending offline payments returned successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.get("/payments/pending", authenticate, requireAdmin, adminController.getPendingOfflinePayments);
// =====================================================
// BOOKINGS
// =====================================================
/**
 * @openapi
 * /api/admin/bookings:
 *   get:
 *     tags:
 *       - Admin
 *     summary: Get all bookings
 *     description: Returns all bookings for the admin dashboard.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Bookings returned successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.get("/bookings", authenticate, requireAdmin, adminController.getAllBookings);
/**
 * @openapi
 * /api/admin/bookings/{bookingId}:
 *   get:
 *     tags:
 *       - Admin
 *     summary: Get a booking by ID
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
 *         description: Booking returned successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: Booking not found
 */
router.get("/bookings/:bookingId", authenticate, requireAdmin, adminController.getBookingById);
/**
 * @openapi
 * /api/admin/bookings/{bookingId}/cancel:
 *   post:
 *     tags:
 *       - Admin
 *     summary: Cancel a booking as an administrator
 *     description: Cancels a booking from the admin dashboard and restores a membership credit when applicable.
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
 *       403:
 *         description: Admin access required
 *       404:
 *         description: Booking not found
 */
router.post("/bookings/:bookingId/cancel", authenticate, requireAdmin, adminController.cancelBooking);
/**
 * @openapi
 * /api/admin/bookings/{bookingId}:
 *   delete:
 *     tags:
 *       - Admin
 *     summary: Delete a booking
 *     description: Permanently deletes a booking and performs the related membership/session cleanup.
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
 *         description: Booking deleted successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: Booking not found
 */
router.delete("/bookings/:bookingId", authenticate, requireAdmin, adminController.deleteBooking);
// =====================================================
// PAYMENT DETAILS
// =====================================================
/**
 * @openapi
 * /api/admin/payments/{bookingId}:
 *   get:
 *     tags:
 *       - Admin
 *       - Payment
 *     summary: Get payment details for a booking
 *     description: Returns payment information associated with a booking.
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
 *         description: Payment details returned successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: Booking or payment not found
 */
router.get("/payments/:bookingId", authenticate, requireAdmin, adminController.getPaymentDetails);
// =====================================================
// CONFIRM OFFLINE PAYMENT
// =====================================================
/**
 * @openapi
 * /api/admin/payments/{bookingId}/confirm:
 *   post:
 *     tags:
 *       - Admin
 *       - Payment
 *     summary: Confirm an offline payment
 *     description: Confirms an offline payment for a booking.
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
 *         description: Offline payment confirmed successfully
 *       400:
 *         description: Payment cannot be confirmed
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: Booking not found
 */
router.post("/payments/:bookingId/confirm", authenticate, requireAdmin, adminController.confirmOfflinePayment);
// =====================================================
// REJECT OFFLINE PAYMENT
// =====================================================
/**
 * @openapi
 * /api/admin/payments/{bookingId}/reject:
 *   post:
 *     tags:
 *       - Admin
 *       - Payment
 *     summary: Reject an offline payment
 *     description: Rejects an offline payment submitted for a booking.
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
 *         description: Offline payment rejected successfully
 *       400:
 *         description: Payment cannot be rejected
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: Booking not found
 */
router.post("/payments/:bookingId/reject", authenticate, requireAdmin, adminController.rejectOfflinePayment);
// =====================================================
// CLASS SESSION MANAGEMENT
// =====================================================
/**
 * @openapi
 * /api/admin/sessions:
 *   get:
 *     tags:
 *       - Admin
 *       - Class Sessions
 *     summary: Get class sessions
 *     description: Returns class sessions for administrative management.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Sessions returned successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.get("/sessions", authenticate, requireAdmin, adminSessionController.getSessions);
/**
 * @openapi
 * /api/admin/sessions/{sessionId}:
 *   get:
 *     tags:
 *       - Admin
 *       - Class Sessions
 *     summary: Get a class session by ID
 *     security:
 *       - bearerAuth: []
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
 *         description: Session returned successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: Session not found
 */
router.get("/sessions/:sessionId", authenticate, requireAdmin, adminSessionController.getSession);
/**
 * @openapi
 * /api/admin/sessions/{sessionId}/cancel:
 *   post:
 *     tags:
 *       - Admin
 *       - Class Sessions
 *     summary: Cancel a class session
 *     description: Cancels a class session from the admin dashboard.
 *     security:
 *       - bearerAuth: []
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
 *         description: Session cancelled successfully
 *       400:
 *         description: Session cannot be cancelled
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: Session not found
 */
router.post("/sessions/:sessionId/cancel", authenticate, requireAdmin, adminSessionController.cancelSession);
/**
 * @openapi
 * /api/admin/sessions/{sessionId}/reopen:
 *   post:
 *     tags:
 *       - Admin
 *       - Class Sessions
 *     summary: Reopen a class session
 *     description: Reopens a previously cancelled class session.
 *     security:
 *       - bearerAuth: []
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
 *         description: Session reopened successfully
 *       400:
 *         description: Session cannot be reopened
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: Session not found
 */
router.post("/sessions/:sessionId/reopen", authenticate, requireAdmin, adminSessionController.reopenSession);
export default router;
//# sourceMappingURL=admin.route.js.map