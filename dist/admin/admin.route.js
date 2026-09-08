import { Router } from "express";
import authenticate from "../middleware/authenticate.js";
import requireAdmin from "../middleware/requireAdmin.js";
import { adminController } from "./admin.controller.js";
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
export default router;
//# sourceMappingURL=admin.route.js.map