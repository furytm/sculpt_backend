import prisma from "../config/prisma.js";
import membershipService from "../membership/membership.service.js";
import paymentService from "./payment.service.js";
import { sendPaymentConfirmationEmail, sendAdminPaymentNotificationEmail, } from "../utils/mailer.js";
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
        let paymentVerified = false;
        try {
            if (!frontendUrl) {
                throw new Error("FRONTEND_URL is not configured.");
            }
            if (!reference) {
                return res.redirect(`${frontendUrl}/confirmation?payment=failed`);
            }
            // Verify directly with Paymish before sending notifications.
            const verification = await paymentService.verifyTransaction(reference);
            const transaction = verification?.data;
            const isVerified = verification?.status === "success" &&
                transaction?.status?.toLowerCase() === "completed" &&
                transaction?.reference === reference;
            if (!isVerified) {
                console.warn("Payment not verified:", reference);
                return res.redirect(`${frontendUrl}/confirmation?payment=failed&reference=${encodeURIComponent(reference)}`);
            }
            paymentVerified = true;
            console.log("Payment successfully verified:", reference);
            const membershipPurchase = await prisma.membershipPurchase.findUnique({
                where: { paymentReference: reference },
                include: { membership: true },
            });
            // --------------------------------------------------
            // MEMBERSHIP PURCHASE: NEW, RENEWAL OR UPGRADE
            // --------------------------------------------------
            if (membershipPurchase) {
                await membershipService.completeMembershipPurchase(reference);
                const customerName = membershipPurchase.fullName || "Sculpt LAB customer";
                // Send registration/login email for new memberships.
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
                        console.error("Membership paid, but customer email failed:", reference, error);
                    }
                }
                // Alert admin for all membership payment types.
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
                    console.error("Membership paid, but admin email failed:", reference, error);
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
                console.error("Verified booking has no customer email:", reference);
            }
            const emailResults = await Promise.allSettled(emailTasks);
            emailResults.forEach((result, index) => {
                if (result.status === "rejected") {
                    console.error(`Payment notification email ${index + 1} failed:`, reference, result.reason);
                }
            });
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