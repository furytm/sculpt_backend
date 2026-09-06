import paymentService from "./payment.service.js";
import bookingService from "../booking/booking.service.js";
class PaymentController {
    async initializePayment(req, res) {
        try {
            const payment = await paymentService.initializeTransaction(req.body);
            res.status(200).json(payment);
        }
        catch (error) {
            res.status(500).json(error);
        }
    }
    async verifyPayment(req, res) {
        try {
            const payment = await paymentService.verifyTransaction(req.params.reference);
            return res.status(200).json(payment);
        }
        catch (error) {
            return res.status(500).json(error);
        }
    }
    async webhook(req, res) {
        try {
            const response = await paymentService.handleWebhook(req.body);
            res.status(200).json(response);
        }
        catch (error) {
            res.status(500).json(error);
        }
    }
    async callback(req, res) {
        try {
            const { reference } = req.query;
            if (!reference || typeof reference !== "string") {
                return res.status(400).json({
                    success: false,
                    message: "Payment reference is required.",
                });
            }
            // Paymish verification is currently returning 404
            // even after a successful checkout.
            // Temporarily mark the matching booking as paid.
            await bookingService.markBookingPaid(reference);
            return res.redirect(`https://sculpt-labs.vercel.app/confirmation?reference=${encodeURIComponent(reference)}`);
        }
        catch (error) {
            console.error("Payment Callback Error:", error);
            return res.redirect("https://sculpt-labs.vercel.app/confirmation?payment=failed");
        }
    }
}
export default new PaymentController();
//# sourceMappingURL=payment.controller.js.map