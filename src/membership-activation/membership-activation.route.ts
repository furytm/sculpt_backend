import { Router } from "express";

import { membershipActivationController } from "./membership-activation.controller.js";
import { auditAction } from "../activity-log/activity-audit.middleware.js";

const router = Router();

// Activity auditing (observes only). Public routes: anonymous failures
// are capped at one event a minute so they cannot flood the log.
const activationAudit = {
  verify: auditAction({
    action: "membership.activation",
    description: "Activation link checked",
    capAnonymousFailures: true,
  }),
  complete: auditAction({
    action: "membership.activation",
    description: "Membership activation completed",
    entityType: "USER",
    entityIdFromResponse: (payload) => payload?.user?.id ?? null,
    subjectFromResponse: (payload) => payload?.user?.id ?? null,
    capAnonymousFailures: true,
  }),
};

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
  activationAudit.verify,
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
  activationAudit.complete,
  membershipActivationController.complete
);
router.post(
  "/resend",
  membershipActivationController.resend
);

export default router;