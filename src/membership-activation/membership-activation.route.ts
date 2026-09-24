import { Router } from "express";

import { membershipActivationController } from "./membership-activation.controller.js";

const router = Router();

/**
 * @openapi
 * /api/membership-activation/verify:
 *   post:
 *     tags:
 *       - Membership Activation
 *     summary: Verify membership activation
 *     description: Verifies the information required to activate a membership.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               bookingId:
 *                 type: string
 *                 example: clx123456789
 *     responses:
 *       200:
 *         description: Membership verification completed successfully
 *       400:
 *         description: Membership verification failed
 *       404:
 *         description: Booking or membership not found
 */
router.post(
  "/verify",
  membershipActivationController.verify
);

/**
 * @openapi
 * /api/membership-activation/complete:
 *   post:
 *     tags:
 *       - Membership Activation
 *     summary: Complete membership activation
 *     description: Completes the activation of a membership after verification.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               bookingId:
 *                 type: string
 *                 example: clx123456789
 *     responses:
 *       200:
 *         description: Membership activated successfully
 *       400:
 *         description: Membership activation failed
 *       404:
 *         description: Booking or membership not found
 */
router.post(
  "/complete",
  membershipActivationController.complete
);

export default router;