import { Router } from "express";
import paymentController from "./payment.controller.js";
const router = Router();
// =====================================================
// INITIALIZE PAYMISH PAYMENT
// =====================================================
/**
 * @openapi
 * /api/payments/initialize:
 *   post:
 *     tags:
 *       - Payment
 *     summary: Initialize Paymish payment
 *     description: Initializes a Paymish transaction for an existing booking and returns the authorization URL.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - bookingId
 *             properties:
 *               bookingId:
 *                 type: string
 *                 description: Booking ID
 *                 example: clx123456789
 *     responses:
 *       200:
 *         description: Paymish transaction initialized successfully
 *       400:
 *         description: Invalid payment request
 *       404:
 *         description: Booking not found
 */
router.post("/initialize", paymentController.initializePayment);
// =====================================================
// VERIFY PAYMISH TRANSACTION
// =====================================================
/**
 * @openapi
 * /api/payments/verify/{reference}:
 *   get:
 *     tags:
 *       - Payment
 *     summary: Verify Paymish transaction
 *     description: Manually verifies a Paymish transaction using its payment reference. This endpoint is retained for manual testing.
 *     parameters:
 *       - in: path
 *         name: reference
 *         required: true
 *         schema:
 *           type: string
 *         description: Paymish payment reference
 *         example: SL-1788605831326
 *     responses:
 *       200:
 *         description: Payment verification result returned successfully
 *       400:
 *         description: Invalid payment reference
 *       404:
 *         description: Transaction not found
 */
router.get("/verify/:reference", paymentController.verifyPayment);
// =====================================================
// PAYMISH CALLBACK
// =====================================================
/**
 * @openapi
 * /api/payments/callback:
 *   get:
 *     tags:
 *       - Payment
 *     summary: Paymish payment callback
 *     description: Callback endpoint used by Paymish after a payment attempt. The payment reference is used to update the booking payment status.
 *     parameters:
 *       - in: query
 *         name: reference
 *         required: true
 *         schema:
 *           type: string
 *         description: Paymish payment reference
 *         example: SL-1788605831326
 *     responses:
 *       302:
 *         description: Redirect after payment callback
 *       400:
 *         description: Invalid or missing payment reference
 */
router.get("/callback", paymentController.callback);
// =====================================================
// PAYMISH WEBHOOK
// =====================================================
/**
 * @openapi
 * /api/payments/webhook:
 *   post:
 *     tags:
 *       - Payment
 *     summary: Paymish webhook
 *     description: Receives payment event notifications from Paymish.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: true
 *     responses:
 *       200:
 *         description: Webhook received successfully
 *       400:
 *         description: Invalid webhook payload
 */
router.post("/webhook", paymentController.webhook);
export default router;
//# sourceMappingURL=payment.routes.js.map