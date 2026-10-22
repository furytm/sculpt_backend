import prisma from "../config/prisma.js";
import membershipService from "../membership/membership.service.js";
import paymentService from "./payment.service.js";
import { sendPaymentConfirmationEmail } from "../utils/mailer.js";
import bookingService from "../booking/booking.service.js";
class PaymentController {
    // =========================================================
    // INITIALIZE PAYMENT
    // =========================================================
    async initializePayment(req, res) {
        try {
            const payment = await paymentService.initializeTransaction(req.body);
            return res.status(200).json(payment);
        }
        catch (error) {
            console.error("Paymish Initialize Error:", error);
            return res.status(500).json({
                success: false,
                message: "Unable to initialize payment.",
                error,
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
            console.error("Paymish Verify Error:", error);
            return res.status(500).json({
                success: false,
                message: "Unable to verify payment.",
                error,
            });
        }
    }
    async callback(req, res) {
        const frontendUrl = process.env.FRONTEND_URL?.replace(/\/$/, "");
        const reference = typeof req.query.reference === "string"
            ? req.query.reference.trim()
            : "";
        try {
            console.log("========== PAYMISH CALLBACK ==========");
            console.log("REFERENCE:", reference);
            if (!frontendUrl) {
                throw new Error("FRONTEND_URL is not configured.");
            }
            if (!reference) {
                return res.redirect(`${frontendUrl}/confirmation?payment=failed`);
            }
            // 1. Verify payment directly with Paymish.
            const verification = await paymentService.verifyTransaction(reference);
            const transaction = verification?.data;
            const isVerified = verification?.status === "success" &&
                transaction?.status?.toLowerCase() === "completed" &&
                transaction?.reference === reference;
            if (!isVerified) {
                console.warn("Payment not verified:", reference);
                return res.redirect(`${frontendUrl}/confirmation?payment=failed&reference=${encodeURIComponent(reference)}`);
            }
            console.log("Payment successfully verified:", reference);
            // 2. Check membership renewal/upgrade purchases.
            const membershipPurchase = await prisma.membershipPurchase.findUnique({
                where: {
                    paymentReference: reference,
                },
            });
            if (membershipPurchase) {
                await membershipService.completeMembershipPurchase(reference);
                const mode = membershipPurchase.type === "UPGRADE"
                    ? "upgrade"
                    : "renew";
                return res.redirect(`${frontendUrl}/confirmation?status=success&mode=${mode}&reference=${encodeURIComponent(reference)}`);
            }
            // 3. Mark the specific booking as paid.
            await bookingService.markBookingPaid(reference);
            // 4. Send the customer an email with registration/login links.
            // Email failure must not turn a verified payment into a failure.
            try {
                const continuation = await bookingService.continueGuestBooking(reference);
                const booking = continuation.booking;
                if (!booking.email) {
                    throw new Error("The paid booking has no customer email address.");
                }
                const registrationUrl = `${frontendUrl}/register?reference=${encodeURIComponent(reference)}`;
                const loginUrl = `${frontendUrl}/login?reference=${encodeURIComponent(reference)}`;
                await sendPaymentConfirmationEmail({
                    email: booking.email,
                    fullName: booking.fullName || "Sculpt LAB customer",
                    bookingReference: reference,
                    registrationUrl,
                    loginUrl,
                });
                console.log("Payment confirmation email sent:", reference);
            }
            catch (emailError) {
                console.error("Payment confirmed, but continuation email could not be sent:", reference, emailError);
            }
            // 5. Return to the confirmation page.
            return res.redirect(`${frontendUrl}/confirmation?status=success&reference=${encodeURIComponent(reference)}`);
        }
        catch (error) {
            console.error("Paymish Callback Error:", error);
            if (!frontendUrl) {
                return res.status(500).json({
                    success: false,
                    message: "Payment callback configuration error.",
                });
            }
            return res.redirect(`${frontendUrl}/confirmation?payment=failed${reference
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
            console.error("Paymish Webhook Error:", error);
            return res.status(400).json({
                success: false,
                message: error?.message ||
                    "Webhook processing failed.",
            });
        }
    }
}
export default new PaymentController();
//# sourceMappingURL=payment.controller.js.map