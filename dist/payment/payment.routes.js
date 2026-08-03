import { Router } from "express";
import paymentController from "./payment.controller.js";
const router = Router();
// Initialize a new transaction
router.post("/initialize", paymentController.initializePayment);
// Verify a transaction
router.get("/verify/:reference", paymentController.verifyPayment);
// Receive Paymish webhook events
router.post("/webhook", paymentController.webhook);
export default router;
//# sourceMappingURL=payment.routes.js.map