import prisma from "../config/prisma.js";
import membershipService, { PaidFailedPurchaseError, } from "../membership/membership.service.js";
import paymentService from "./payment.service.js";
import { sendPaymentConfirmationEmail, sendAdminPaymentNotificationEmail, } from "../utils/mailer.js";
import bookingService from "../booking/booking.service.js";
import { adminNotificationService } from "../admin/admin-notification.service.js";
import { getRequestId, setCorrelationId } from "../observability/request-context.js";
import { logger } from "../observability/logger.js";
import { describeError } from "../observability/errors.js";
import activityLog, { unmatchedDedupeKey } from "../activity-log/activity-log.service.js";
/**
 * A notification or email failed after a successful payment. The
 * payment stands; this only records it (as before, it is not retried).
 */
function recordNotificationFailure(reference, notification, error) {
    const description = describeError(error);
    logger.warn("payment.callback.notification_failed", {
        reference,
        notification,
        errorMessage: description.logMessage,
        // Server logs only; never sent to the browser or the activity log.
        stack: description.logStack,
    });
    activityLog.record({
        action: "payment.callback",
        stage: "WARNING",
        status: "WARNING",
        paymentReference: reference,
        errorCode: "NOTIFICATION_FAILED",
        errorMessage: description.logMessage,
        description: "Payment succeeded, but a notification could not be sent.",
        dedupeKey: `payment.callback.notification_failed:${notification}:${reference}`,
        metadata: { notification },
    });
}
class PaymentController {
    // =========================================================
    // INITIALIZE PAYMENT
    // =========================================================
    async initializePayment(req, res) {
        logger.info("payment.initialize.request");
        try {
            const payment = await paymentService.initializeTransaction(req.body);
            return res.status(200).json(payment);
        }
        catch (error) {
            const description = describeError(error);
            logger.error("payment.initialize.error", {
                errorCode: description.code,
                errorMessage: description.logMessage,
                // Server logs only; never sent to the browser or the activity log.
                stack: description.logStack,
            });
            // Unchanged status and message; the raw provider error is no
            // longer included.
            return res.status(500).json({
                success: false,
                message: "Unable to initialize payment.",
                code: description.code,
                requestId: getRequestId(),
            });
        }
    }
    // =========================================================
    // VERIFY PAYMENT
    // =========================================================
    // KEPT FOR MANUAL TESTING ONLY.
    // This is NOT used by the normal payment callback.
    // =========================================================
    async verifyPayment(req, res) {
        try {
            const payment = await paymentService.verifyTransaction(req.params.reference);
            return res.status(200).json(payment);
        }
        catch (error) {
            const description = describeError(error);
            logger.error("payment.verify.error", {
                errorCode: description.code,
                errorMessage: description.logMessage,
                // Server logs only; never sent to the browser or the activity log.
                stack: description.logStack,
            });
            // Unchanged status and message; the raw provider error is no
            // longer included.
            return res.status(500).json({
                success: false,
                message: "Unable to verify payment.",
                code: description.code,
                requestId: getRequestId(),
            });
        }
    }
    async callback(req, res) {
        const frontendUrl = process.env.FRONTEND_URL?.replace(/\/$/, "");
        const reference = typeof req.query.reference === "string"
            ? req.query.reference.trim()
            : "";
        setCorrelationId(reference);
        logger.info("payment.callback.received", { reference: reference || null });
        let paymentVerified = false;
        try {
            if (!frontendUrl) {
                throw new Error("FRONTEND_URL is not configured.");
            }
            if (!reference) {
                activityLog.record({
                    action: "payment.callback",
                    stage: "VALIDATION_FAILED",
                    status: "FAILURE",
                    errorCode: "MISSING_REFERENCE",
                    description: "Payment callback without a payment reference.",
                    // Public endpoint: at most one such event a minute.
                    dedupeKey: unmatchedDedupeKey("payment.callback", "VALIDATION_FAILED"),
                    metadata: { outcome: "payment=failed" },
                });
                return res.redirect(`${frontendUrl}/confirmation?payment=failed`);
            }
            // Verify the transaction directly with Paymish.
            const verification = await paymentService.verifyTransaction(reference);
            const transaction = verification?.data;
            const isVerified = verification?.status === "success" &&
                transaction?.status?.toLowerCase() === "completed" &&
                transaction?.reference === reference;
            if (!isVerified) {
                logger.warn("payment.callback.not_verified", { reference });
                activityLog.record({
                    action: "payment.callback",
                    stage: "VERIFICATION_FAILED",
                    status: "FAILURE",
                    paymentReference: reference,
                    errorCode: "PAYMENT_NOT_VERIFIED",
                    description: "Paymish did not confirm a completed payment for this reference.",
                    metadata: {
                        verificationStatus: typeof verification?.status === "string" ? verification.status : null,
                        transactionStatus: typeof transaction?.status === "string" ? transaction.status : null,
                        outcome: "payment=failed",
                    },
                });
                return res.redirect(`${frontendUrl}/confirmation?payment=failed&reference=${encodeURIComponent(reference)}`);
            }
            paymentVerified = true;
            logger.info("payment.callback.verified", { reference });
            activityLog.record({
                action: "payment.callback",
                stage: "VERIFIED",
                status: "SUCCESS",
                paymentReference: reference,
                description: "Paymish confirmed the payment.",
                dedupeKey: `payment.callback.verified:${reference}`,
            });
            // Check whether this is a membership purchase.
            const membershipPurchase = await prisma.membershipPurchase.findUnique({
                where: { paymentReference: reference },
                include: { membership: true },
            });
            // --------------------------------------------------
            // MEMBERSHIP PURCHASE: NEW, RENEWAL OR UPGRADE
            // --------------------------------------------------
            if (membershipPurchase) {
                try {
                    await membershipService.completeMembershipPurchase(reference);
                }
                catch (error) {
                    if (error instanceof PaidFailedPurchaseError) {
                        // Paid, but the purchase had been cancelled or replaced.
                        // Record it for an admin to refund or apply, and tell the
                        // customer the payment was received and is under review,
                        // rather than that it succeeded or failed.
                        await membershipService.recordPaymentForFailedPurchase(reference, "payment-callback");
                        activityLog.record({
                            action: "payment.callback",
                            stage: "WARNING",
                            status: "WARNING",
                            paymentReference: reference,
                            errorCode: "PAID_FAILED_PURCHASE",
                            description: "Paid a cancelled or superseded purchase; recorded for admin review.",
                            dedupeKey: `payment.callback.reconciliation:${reference}`,
                            metadata: { reconciliationRequired: true, outcome: "payment=review" },
                        });
                        return res.redirect(`${frontendUrl}/confirmation?payment=review&type=membership&reference=${encodeURIComponent(reference)}`);
                    }
                    throw error;
                }
                const customerName = membershipPurchase.fullName || "Sculpt LAB customer";
                // Create the admin database notification.
                // Notification failures must not interrupt a successful payment.
                try {
                    await adminNotificationService.createForAllAdmins({
                        eventKey: `paymish:${reference}`,
                        type: "PAYMENT",
                        title: "Membership payment received",
                        message: `${customerName} completed a ${membershipPurchase.type.toLowerCase()} membership payment.`,
                        data: {
                            reference,
                            paymentType: `Membership ${membershipPurchase.type}`,
                            amount: String(membershipPurchase.amount),
                        },
                    });
                }
                catch (notificationError) {
                    recordNotificationFailure(reference, "admin_database", notificationError);
                }
                // Preserve the existing customer email for new memberships.
                if (membershipPurchase.type === "NEW" &&
                    membershipPurchase.email) {
                    try {
                        await sendPaymentConfirmationEmail({
                            email: membershipPurchase.email,
                            fullName: customerName,
                            bookingReference: reference,
                            registrationUrl: `${frontendUrl}/register?reference=${encodeURIComponent(reference)}`,
                            loginUrl: `${frontendUrl}/login?reference=${encodeURIComponent(reference)}`,
                        });
                    }
                    catch (error) {
                        recordNotificationFailure(reference, "customer_email", error);
                    }
                }
                // Preserve the existing admin payment email.
                try {
                    await sendAdminPaymentNotificationEmail({
                        fullName: customerName,
                        email: membershipPurchase.email,
                        amount: membershipPurchase.amount,
                        paymentReference: reference,
                        paymentType: `Membership ${membershipPurchase.type}`,
                    });
                }
                catch (error) {
                    recordNotificationFailure(reference, "admin_email", error);
                }
                if (membershipPurchase.type === "NEW") {
                    return res.redirect(`${frontendUrl}/confirmation?status=success&type=membership&reference=${encodeURIComponent(reference)}`);
                }
                if (membershipPurchase.type === "UPGRADE" ||
                    membershipPurchase.type === "RENEWAL") {
                    const mode = membershipPurchase.type === "UPGRADE"
                        ? "upgrade"
                        : "renew";
                    return res.redirect(`${frontendUrl}/confirmation?status=success&mode=${mode}&reference=${encodeURIComponent(reference)}`);
                }
                throw new Error(`Unsupported membership purchase type: ${membershipPurchase.type}`);
            }
            // --------------------------------------------------
            // BOOKING PAYMENT
            // --------------------------------------------------
            await bookingService.markBookingPaid(reference);
            const continuation = await bookingService.continueGuestBooking(reference);
            const booking = continuation.booking;
            // Create the admin database notification after payment
            // and guest booking continuation have succeeded.
            try {
                await adminNotificationService.createForAllAdmins({
                    eventKey: `paymish:${reference}`,
                    type: "PAYMENT",
                    title: "Booking payment received",
                    message: `${booking.fullName || "A customer"} completed a booking payment.`,
                    data: {
                        reference,
                        paymentType: "Booking",
                        amount: String(booking.amount),
                    },
                });
            }
            catch (notificationError) {
                recordNotificationFailure(reference, "admin_database", notificationError);
            }
            // Send customer and admin emails independently.
            const emailTasks = [];
            if (booking.email) {
                emailTasks.push(sendPaymentConfirmationEmail({
                    email: booking.email,
                    fullName: booking.fullName || "Sculpt LAB customer",
                    bookingReference: reference,
                    registrationUrl: `${frontendUrl}/register?reference=${encodeURIComponent(reference)}`,
                    loginUrl: `${frontendUrl}/login?reference=${encodeURIComponent(reference)}`,
                }));
                emailTasks.push(sendAdminPaymentNotificationEmail({
                    fullName: booking.fullName || "Sculpt LAB customer",
                    email: booking.email,
                    amount: booking.amount,
                    paymentReference: reference,
                    paymentType: "Booking",
                }));
            }
            else {
                logger.error("payment.callback.booking_without_email", { reference });
            }
            const emailResults = await Promise.allSettled(emailTasks);
            emailResults.forEach((result, index) => {
                if (result.status === "rejected") {
                    recordNotificationFailure(reference, index === 0 ? "customer_email" : "admin_email", result.reason);
                }
            });
            return res.redirect(`${frontendUrl}/confirmation?status=success&reference=${encodeURIComponent(reference)}`);
        }
        catch (error) {
            const description = describeError(error);
            logger.error("payment.callback.error", {
                reference: reference || null,
                paymentVerified,
                errorCode: description.code,
                errorMessage: description.logMessage,
                // Server logs only; never sent to the browser or the activity log.
                stack: description.logStack,
            });
            activityLog.record({
                action: "payment.callback",
                stage: description.kind === "provider" ? "PROVIDER_FAILED" : "FAILED",
                status: "FAILURE",
                paymentReference: reference || null,
                errorCode: description.code,
                errorMessage: description.logMessage,
                description: paymentVerified
                    ? "Payment was verified, but processing it failed."
                    : "The payment could not be verified.",
                metadata: {
                    errorKind: description.kind,
                    outcome: paymentVerified ? "status=success" : "payment=failed",
                },
            });
            if (!frontendUrl) {
                return res.status(500).json({
                    success: false,
                    message: "Payment callback configuration error.",
                });
            }
            return res.redirect(`${frontendUrl}/confirmation?${paymentVerified ? "status=success" : "payment=failed"}${reference
                ? `&reference=${encodeURIComponent(reference)}`
                : ""}`);
        }
    }
    // =========================================================
    // WEBHOOK
    // =========================================================
    async webhook(req, res) {
        try {
            const signature = req.headers["x-paymish-signature"];
            const signatureValue = Array.isArray(signature)
                ? signature[0]
                : signature;
            const rawBody = req.body;
            const response = await paymentService.handleWebhook(rawBody, signatureValue);
            return res.status(200).json(response);
        }
        catch (error) {
            const description = describeError(error);
            const signatureFailure = description.kind === "business" &&
                /webhook signature/i.test(description.publicMessage);
            logger.error("payment.webhook.error", {
                errorCode: description.code,
                errorMessage: description.logMessage,
                // Server logs only; never sent to the browser or the activity log.
                stack: description.logStack,
            });
            activityLog.record({
                action: "payment.webhook",
                stage: "FAILED",
                status: "FAILURE",
                actorType: "WEBHOOK",
                errorCode: signatureFailure ? "WEBHOOK_SIGNATURE_INVALID" : description.code,
                errorMessage: description.logMessage,
                httpStatus: 400,
                // Anyone can post a bad signature: at most one such event a minute.
                dedupeKey: signatureFailure ? unmatchedDedupeKey("payment.webhook", "SIGNATURE_INVALID") : null,
                metadata: { errorKind: description.kind },
            });
            // Status stays 400 for every failure (Paymish's retry behaviour is
            // unchanged). Our own messages are kept; internal errors (database,
            // provider) no longer leak their text.
            return res.status(400).json({
                success: false,
                message: (description.kind === "business" && description.publicMessage) ||
                    "Webhook processing failed.",
                requestId: getRequestId(),
            });
        }
    }
}
export default new PaymentController();
//# sourceMappingURL=payment.controller.js.map