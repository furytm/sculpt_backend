import { Router } from "express";
import { UserRole } from "@prisma/client";
import authenticate from "../middleware/authenticate.js";
import requireAdmin from "../middleware/requireAdmin.js";
import requireRole from "../middleware/requireRole.js";
import { adminController } from "./admin.controller.js";
import adminSessionController from "./admin-session.controller.js";
import adminNotificationController from "./admin-notification.controller.js";
import { adminAudit } from "./admin-activity-audit.js";
import { activityLogController } from "../activity-log/activity-log.controller.js";
import { healthSafetyController, adminMembershipPlansController } from "../health-safety/health-safety.controller.js";
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
// ADMIN NOTIFICATIONS
// =====================================================
router.get("/notifications", authenticate, requireAdmin, adminNotificationController.getNotifications);
router.patch("/notifications/:id/read", authenticate, requireAdmin, adminNotificationController.markAsRead);
router.patch("/notifications/read-all", authenticate, requireAdmin, adminNotificationController.markAllAsRead);
router.post("/notifications/push-subscription", authenticate, requireAdmin, adminNotificationController.savePushSubscription);
router.delete("/notifications/push-subscription", authenticate, requireAdmin, adminNotificationController.deletePushSubscription);
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
// ACTIVITY LOGS (admin only, read only)
// =====================================================
router.get("/activity-logs", authenticate, requireAdmin, activityLogController.list);
router.get("/activity-logs/errors", authenticate, requireAdmin, activityLogController.errors);
router.get("/activity-logs/operations/:correlationId", authenticate, requireAdmin, activityLogController.operation);
router.get("/members/:memberId/activity-logs", authenticate, requireAdmin, activityLogController.forMember);
// =====================================================
// HEALTH & SAFETY (admin only)
// =====================================================
router.get("/health-safety", authenticate, requireAdmin, healthSafetyController.adminList);
router.get("/health-safety/revisions", authenticate, requireAdmin, healthSafetyController.adminRevisions);
// =====================================================
// MEMBERSHIP PLANS (admin only): every plan, active and inactive
// =====================================================
router.get("/memberships", authenticate, requireAdmin, adminMembershipPlansController.list);
router.post("/resend-registration-email", authenticate, requireAdmin, adminAudit.resendActivation, adminController.resendRegistrationEmail);
router.post("/sessions/:sessionId/offline-attendees", authenticate, requireAdmin, adminAudit.addOfflineAttendee, adminSessionController.addOfflineAttendee);
router.get('/members/:userId/classes', authenticate, requireAdmin, adminController.getMemberClasses.bind(adminController));
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
// =====================================================
// ADMIN TUTOR SCHEDULE CALENDAR
// =====================================================
// ADMIN sees every tutor; TUTOR sees only their own schedule
// (read-only, scoped in the controller from their own account).
router.get("/tutor-schedule", authenticate, requireRole(UserRole.ADMIN, UserRole.TUTOR), adminController.getTutorSchedule);
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
router.post("/bookings/:bookingId/cancel", authenticate, requireAdmin, adminAudit.cancelBooking, adminController.cancelBooking);
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
router.delete("/bookings/:bookingId", authenticate, requireAdmin, adminAudit.deleteBooking, adminController.deleteBooking);
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
router.post("/payments/:bookingId/confirm", authenticate, requireAdmin, adminAudit.confirmOfflinePayment, adminController.confirmOfflinePayment);
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
router.post("/payments/:bookingId/reject", authenticate, requireAdmin, adminAudit.rejectOfflinePayment, adminController.rejectOfflinePayment);
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
router.post("/sessions/:sessionId/cancel", authenticate, requireAdmin, adminAudit.cancelSession, adminSessionController.cancelSession);
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
router.post("/sessions/:sessionId/reopen", authenticate, requireAdmin, adminAudit.reopenSession, adminSessionController.reopenSession);
// =====================================================
// OFFLINE MEMBER ONBOARDING
// =====================================================
/**
 * @openapi
 * /api/admin/members/offline:
 *   post:
 *     tags:
 *       - Admin
 *       - Members
 *     summary: Create an offline member
 *     description: Creates a paid offline membership for a member who may not have an account yet.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - membershipId
 *             properties:
 *               fullName:
 *                 type: string
 *                 example: John Doe
 *               email:
 *                 type: string
 *                 format: email
 *                 example: john@example.com
 *               phone:
 *                 type: string
 *                 example: 08012345678
 *               membershipId:
 *                 type: string
 *                 example: cmufazfh20002veb8hhfic2te
 *               classSessionId:
 *                 type: string
 *                 example: cmufd6l8x0041ve9c41tzxbin
 *     responses:
 *       201:
 *         description: Offline member created successfully
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.post("/members/offline", authenticate, requireAdmin, adminAudit.createOfflineMember, adminController.createOfflineMember);
router.get('/members', authenticate, requireAdmin, adminController.getAllMembers.bind(adminController));
router.delete("/members/:memberId", authenticate, requireAdmin, adminAudit.deleteMember, adminController.deleteMember.bind(adminController));
router.get("/membership-purchases", authenticate, requireAdmin, adminController.getAllMembershipPurchases);
/**
 * @openapi
 * /api/admin/members/{memberId}/memberships:
 *   post:
 *     tags:
 *       - Admin
 *       - Members
 *     summary: Add an offline membership to an existing registered member
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: memberId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - membershipId
 *             properties:
 *               membershipId:
 *                 type: string
 *               totalCredits:
 *                 type: integer
 *               usedCredits:
 *                 type: integer
 *               startDate:
 *                 type: string
 *                 format: date
 *     responses:
 *       201:
 *         description: Membership added successfully
 *       400:
 *         description: Invalid request
 *       404:
 *         description: Member or membership not found
 */
router.post("/members/:memberId/memberships", authenticate, requireAdmin, adminAudit.addMembershipToMember, adminController.addMembershipToMember.bind(adminController));
// =====================================================
// OFFLINE MEMBERSHIP PURCHASES
// =====================================================
// Get pending offline membership purchases
router.get("/membership-purchases/pending", authenticate, requireAdmin, adminController.getPendingOfflineMembershipPurchases);
// Confirm an offline membership purchase
router.post("/membership-purchases/:purchaseId/confirm", authenticate, requireAdmin, adminAudit.confirmMembershipPurchase, adminController.confirmOfflineMembershipPurchase);
// Retry the selected first class of a paid, activated offline
// membership purchase (never confirms or charges the payment again)
router.post("/membership-purchases/:purchaseId/first-booking/retry", authenticate, requireAdmin, adminAudit.retryFirstBooking, adminController.retryOfflineMembershipFirstBooking.bind(adminController));
// Reject an offline membership purchase
router.post("/membership-purchases/:purchaseId/reject", authenticate, requireAdmin, adminAudit.rejectMembershipPurchase, adminController.rejectOfflineMembershipPurchase);
// =====================================================
// PAYMENTS FOR CANCELLED OR SUPERSEDED PURCHASES
// =====================================================
// A customer paid a purchase that had been cancelled or replaced.
// The payment is recorded and admins are notified; an admin then
// either applies the purchase or refunds it (in the Paymish
// dashboard) and records the refund here.
router.get("/membership-purchases/reconciliation", authenticate, requireAdmin, adminController.getPurchasesNeedingReconciliation.bind(adminController));
router.post("/membership-purchases/:purchaseId/reconciliation/apply", authenticate, requireAdmin, adminAudit.applyPaidFailedPurchase, adminController.applyPaidFailedPurchase.bind(adminController));
router.post("/membership-purchases/:purchaseId/reconciliation/refunded", authenticate, requireAdmin, adminAudit.markPurchaseRefunded, adminController.markPaidFailedPurchaseRefunded.bind(adminController));
export default router;
//# sourceMappingURL=admin.route.js.map