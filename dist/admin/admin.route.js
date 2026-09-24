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
router.get("/payments/test-activation-service", (_req, res) => {
    console.log("🔥🔥🔥 TEST ACTIVATION ROUTE HIT 🔥🔥🔥");
    return res.json({
        success: true,
        message: "TEST ROUTE WORKS",
    });
});
router.get("/dashboard", authenticate, requireAdmin, adminController.getDashboard);
// =====================================================
// PENDING OFFLINE PAYMENTS
// =====================================================
router.get("/payments/pending", authenticate, requireAdmin, adminController.getPendingOfflinePayments);
// =====================================================
// BOOKINGS
// =====================================================
router.get("/bookings", authenticate, requireAdmin, adminController.getAllBookings);
router.get("/bookings/:bookingId", authenticate, requireAdmin, adminController.getBookingById);
router.post("/bookings/:bookingId/cancel", authenticate, requireAdmin, adminController.cancelBooking);
router.delete("/bookings/:bookingId", authenticate, requireAdmin, adminController.deleteBooking);
// =====================================================
// PAYMENT DETAILS
// =====================================================
router.get("/payments/:bookingId", authenticate, requireAdmin, adminController.getPaymentDetails);
// =====================================================
// CONFIRM OFFLINE PAYMENT
// =====================================================
router.post("/payments/:bookingId/confirm", authenticate, requireAdmin, adminController.confirmOfflinePayment);
// =====================================================
// REJECT OFFLINE PAYMENT
// =====================================================
router.post("/payments/:bookingId/reject", authenticate, requireAdmin, adminController.rejectOfflinePayment);
// =====================================================
// CLASS SESSION MANAGEMENT
// =====================================================
router.get("/sessions", authenticate, requireAdmin, adminSessionController.getSessions);
router.get("/sessions/:sessionId", authenticate, requireAdmin, adminSessionController.getSession);
router.post("/sessions/:sessionId/cancel", authenticate, requireAdmin, adminSessionController.cancelSession);
router.post("/sessions/:sessionId/reopen", authenticate, requireAdmin, adminSessionController.reopenSession);
export default router;
//# sourceMappingURL=admin.route.js.map