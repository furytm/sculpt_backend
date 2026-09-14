import { Router } from "express";
import paymentController from "./payment.controller.js";

const router = Router();

// Initialize Paystack transaction
router.post(
  "/initialize",
  paymentController.initializePayment
);

// Verify Paystack transaction
router.get(
  "/verify/:reference",
  paymentController.verifyPayment
);

// Paystack callback
router.get(
  "/callback",
  paymentController.callback
);

// Paystack webhook
router.post(
  "/webhook",
  paymentController.webhook
);

export default router;