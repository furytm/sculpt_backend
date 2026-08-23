import { Router } from "express";
import paymentController from "./payment.controller.js";

const router = Router();

// Initialize a new transaction
router.post("/initialize", paymentController.initializePayment);

// Verify a transaction
router.get("/verify/:reference", paymentController.verifyPayment);
router.get("/callback", paymentController.callback);

// Receive Paymish webhook events
router.post("/webhook", paymentController.webhook);

export default router;