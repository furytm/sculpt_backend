import { Router } from "express";
import authenticate from "../middleware/authenticate.js";
import requireAdmin from "../middleware/requireAdmin.js";
import { adminController } from "./admin.controller.js";
const router = Router();
console.log("🔥 ADMIN ROUTES LOADED");
router.get("/payments/pending", authenticate, requireAdmin, adminController.getPendingOfflinePayments);
router.get("/payments/:bookingId", authenticate, requireAdmin, adminController.getPaymentDetails);
router.post("/payments/:bookingId/confirm", authenticate, requireAdmin, adminController.confirmOfflinePayment);
router.post("/payments/:bookingId/reject", authenticate, requireAdmin, adminController.rejectOfflinePayment);
export default router;
//# sourceMappingURL=admin.route.js.map