import { Router } from "express";
import paymentController from "./payment.controller.js";
const router = Router();
// Initialize Paymish transaction
router.post("/initialize", paymentController.initializePayment);
// Verify Paymish transaction
// Kept for manual testing only
router.get("/verify/:reference", paymentController.verifyPayment);
// Paymish callback
router.get("/callback", paymentController.callback);
// Paymish webhook
router.post("/webhook", paymentController.webhook);
export default router;
//# sourceMappingURL=payment.routes.js.map