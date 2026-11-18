import axios from "axios";
import crypto from "node:crypto";
import prisma from "../config/prisma.js";
import membershipService, { PaidFailedPurchaseError, } from "../membership/membership.service.js";
import bookingService from "../booking/booking.service.js";
import { isPaymentProviderFailure, toPaymentProviderError } from "./payment-provider.error.js";
import { setCorrelationId } from "../observability/request-context.js";
import { logger } from "../observability/logger.js";
import { describeError } from "../observability/errors.js";
import activityLog from "../activity-log/activity-log.service.js";
/**
 * An unexpected (non-Paymish) error around a Paymish call. Logged with a
 * sanitized stack for the server only; the activity log gets the code
 * and cleaned message, never the stack. Never throws.
 */
function recordInternalPaymentFailure(operation, reference, error) {
    try {
        const description = describeError(error);
        logger.error(`paymish.${operation}.internal_error`, {
            reference: reference ?? null,
            errorCode: description.code,
            errorKind: description.kind,
            errorMessage: description.logMessage,
            // Server logs only.
            stack: description.logStack,
        });
        activityLog.record({
            action: operation === "initialize" ? "payment.initialize" : "payment.verify",
            stage: "FAILED",
            status: "FAILURE",
            paymentReference: reference ?? null,
            errorCode: description.code,
            errorMessage: description.logMessage,
            httpStatus: description.httpStatus,
            metadata: { operation, errorKind: description.kind },
        });
    }
    catch {
        // Logging must never change the outcome.
    }
}
class PaymentService {
    getHeaders() {
        return {
            Authorization: `Bearer ${process.env.PAYMISH_SECRET_KEY}`,
            "Content-Type": "application/json",
        };
    }
    // =========================================================
    // INITIALIZE PAYSTACK TRANSACTION
    // =========================================================
    async initializeTransaction(data) {
        try {
            const payload = {
                email: data.email,
                // Keep the amount exactly as your old Paymish integration used it.
                amount: data.amount,
                currency: data.currency ?? "NGN",
                channels: data.channels ?? [
                    "card",
                    "ussd",
                    "nqr",
                    "transfer",
                ],
                callback_url: data.callback_url ??
                    process.env.PAYMISH_CALLBACK_URL,
                reference: data.reference,
            };
            // This payment's reference ties the rest of the request's events
            // (and the later callback and webhook) into one operation.
            setCorrelationId(data.reference);
            const response = await axios.post(`${process.env.PAYMISH_BASE_URL}/api/transaction-service/external/v1/transaction-initialize`, payload, {
                headers: this.getHeaders(),
            });
            const hasPaymentUrl = Boolean(response.data?.data?.authorization_url ??
                response.data?.data?.authorizationUrl ??
                response.data?.authorization_url ??
                response.data?.authorizationUrl);
            // Safe fields only: no customer data, no payment URL.
            logger.info("paymish.initialize.ok", {
                reference: data.reference,
                providerStatus: response.data?.status ?? null,
                hasPaymentUrl,
            });
            if (!hasPaymentUrl) {
                activityLog.record({
                    action: "payment.initialize",
                    stage: "WARNING",
                    status: "WARNING",
                    paymentReference: data.reference,
                    errorCode: "PAYMENT_URL_MISSING",
                    description: "Paymish accepted the request but returned no payment URL.",
                    metadata: { operation: "initialize", providerCode: response.data?.status ?? null },
                });
            }
            return response.data;
        }
        catch (error) {
            // Not a Paymish failure (a bug, bad data, a missing setting):
            // recorded as internal and rethrown unchanged, as before.
            if (!isPaymentProviderFailure(error)) {
                recordInternalPaymentFailure("initialize", data?.reference, error);
                throw error;
            }
            const providerError = toPaymentProviderError(error, "initialize", data.reference);
            logger.warn("paymish.initialize.failed", {
                reference: data.reference,
                ...providerError.toLogFields(),
            });
            // Recorded against the payment reference; the purchase or booking
            // it belongs to is looked up when the event is stored.
            activityLog.record({
                action: "payment.initialize",
                stage: "PROVIDER_FAILED",
                status: "FAILURE",
                paymentReference: data.reference,
                errorCode: providerError.code,
                errorMessage: describeError(providerError).logMessage,
                httpStatus: 502,
                metadata: providerError.toLogFields(),
            });
            throw providerError;
        }
    }
    // =========================================================
    // VERIFY PAYSTACK TRANSACTION
    // =========================================================
    // =========================================================
    // VERIFY PAYMISH TRANSACTION
    // =========================================================
    async verifyTransaction(reference) {
        try {
            setCorrelationId(reference);
            const response = await axios.get(`${process.env.PAYMISH_BASE_URL}/api/transaction-service/external/v1/verify/${encodeURIComponent(reference)}`, {
                headers: this.getHeaders(),
            });
            // Safe fields only: no customer data.
            logger.info("paymish.verify.ok", {
                reference,
                verificationStatus: response.data?.status ?? null,
                transactionStatus: response.data?.data?.status ?? null,
            });
            return response.data;
        }
        catch (error) {
            if (!isPaymentProviderFailure(error)) {
                recordInternalPaymentFailure("verify", reference, error);
                throw error;
            }
            const providerError = toPaymentProviderError(error, "verify", reference);
            logger.warn("paymish.verify.failed", {
                reference,
                ...providerError.toLogFields(),
            });
            activityLog.record({
                action: "payment.verify",
                stage: "PROVIDER_FAILED",
                status: "FAILURE",
                paymentReference: reference,
                errorCode: providerError.code,
                errorMessage: describeError(providerError).logMessage,
                httpStatus: 502,
                metadata: providerError.toLogFields(),
            });
            throw providerError;
        }
    }
    // =========================================================
    // WEBHOOK
    // =========================================================
    async handleWebhook(rawBody, signature) {
        const webhookSecret = process.env.PAYMISH_WEBHOOK_SECRET;
        if (!webhookSecret) {
            throw new Error("PAYMISH_WEBHOOK_SECRET is not configured.");
        }
        if (!signature) {
            throw new Error("Paymish webhook signature is missing.");
        }
        // =====================================================
        // VERIFY PAYMISH WEBHOOK SIGNATURE
        // =====================================================
        const expectedSignature = crypto
            .createHmac("sha256", webhookSecret)
            .update(rawBody)
            .digest("hex");
        const expectedBuffer = Buffer.from(expectedSignature, "utf8");
        const receivedBuffer = Buffer.from(signature, "utf8");
        if (expectedBuffer.length !==
            receivedBuffer.length) {
            throw new Error("Invalid Paymish webhook signature.");
        }
        if (!crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
            throw new Error("Invalid Paymish webhook signature.");
        }
        // =====================================================
        // PARSE PAYLOAD AFTER SIGNATURE VERIFICATION
        // =====================================================
        let payload;
        try {
            payload = JSON.parse(rawBody.toString("utf8"));
        }
        catch {
            throw new Error("Invalid Paymish webhook JSON payload.");
        }
        // Safe fields only: never the payload (it holds customer details).
        const webhookReference = typeof payload?.data?.reference === "string" ? payload.data.reference : null;
        setCorrelationId(webhookReference);
        logger.info("paymish.webhook.received", {
            webhookEvent: typeof payload?.event === "string" ? payload.event : null,
            reference: webhookReference,
        });
        // =====================================================
        // CHECK EVENT
        // =====================================================
        const event = payload?.event;
        if (event !== "transaction.successful") {
            activityLog.record({
                action: "payment.webhook",
                stage: "RECEIVED",
                status: "INFO",
                actorType: "WEBHOOK",
                paymentReference: webhookReference,
                description: "Webhook event not processed (not a successful transaction).",
                metadata: { webhookEvent: typeof event === "string" ? event : null, processed: false },
            });
            return {
                received: true,
                processed: false,
                event,
            };
        }
        // =====================================================
        // GET TRANSACTION DATA
        // =====================================================
        const transaction = payload?.data;
        if (!transaction) {
            throw new Error("Paymish webhook transaction data is missing.");
        }
        const reference = transaction.reference;
        if (!reference ||
            typeof reference !== "string") {
            throw new Error("Paymish webhook payment reference is missing.");
        }
        // =====================================================
        // CHECK MEMBERSHIP PURCHASE FIRST
        // =====================================================
        const membershipPurchase = await prisma.membershipPurchase.findUnique({
            where: {
                paymentReference: reference,
            },
        });
        if (membershipPurchase) {
            try {
                await membershipService.completeMembershipPurchase(reference);
            }
            catch (error) {
                if (error instanceof PaidFailedPurchaseError) {
                    // The customer paid a cancelled or superseded purchase.
                    // Record it for an admin to refund or apply, then acknowledge
                    // the webhook: retrying could never complete it. Other
                    // errors still fail the webhook, so they are retried.
                    await membershipService.recordPaymentForFailedPurchase(reference, "webhook");
                    activityLog.record({
                        action: "payment.webhook",
                        stage: "WARNING",
                        status: "WARNING",
                        actorType: "WEBHOOK",
                        paymentReference: reference,
                        errorCode: "PAID_FAILED_PURCHASE",
                        description: "Paid a cancelled or superseded purchase; recorded for admin review.",
                        dedupeKey: `payment.webhook.reconciliation:${reference}`,
                        metadata: { processed: false, reconciliationRequired: true },
                    });
                    return {
                        received: true,
                        processed: false,
                        type: "membership",
                        reference,
                        reconciliationRequired: true,
                    };
                }
                throw error;
            }
            activityLog.record({
                action: "payment.webhook",
                stage: "SUCCEEDED",
                status: "SUCCESS",
                actorType: "WEBHOOK",
                paymentReference: reference,
                description: "Membership payment webhook processed.",
                dedupeKey: `payment.webhook.processed:${reference}`,
                metadata: { processed: true, purchaseType: membershipPurchase.type },
            });
            return {
                received: true,
                processed: true,
                type: "membership",
                reference,
            };
        }
        // =====================================================
        // OTHERWISE CHECK NORMAL BOOKING
        // =====================================================
        const booking = await prisma.booking.findUnique({
            where: {
                paymentReference: reference,
            },
        });
        if (!booking) {
            logger.warn("paymish.webhook.unknown_reference", { reference });
            activityLog.record({
                action: "payment.webhook",
                stage: "WARNING",
                status: "WARNING",
                actorType: "WEBHOOK",
                paymentReference: reference,
                errorCode: "PAYMENT_REFERENCE_NOT_FOUND",
                description: "Successful payment webhook for a reference with no booking or membership purchase.",
                dedupeKey: `payment.webhook.unknown:${reference}`,
                metadata: { processed: false },
            });
            return {
                received: true,
                processed: false,
                reference,
                message: "Payment reference not found.",
            };
        }
        // =====================================================
        // MARK BOOKING AS PAID
        // =====================================================
        await bookingService.markBookingPaid(reference);
        activityLog.record({
            action: "payment.webhook",
            stage: "SUCCEEDED",
            status: "SUCCESS",
            actorType: "WEBHOOK",
            paymentReference: reference,
            description: "Booking payment webhook processed.",
            dedupeKey: `payment.webhook.processed:${reference}`,
            metadata: { processed: true },
        });
        return {
            received: true,
            processed: true,
            type: "booking",
            reference,
        };
    }
}
export default new PaymentService();
//# sourceMappingURL=payment.service.js.map