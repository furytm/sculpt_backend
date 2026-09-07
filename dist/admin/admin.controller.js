import { adminService } from "./admin.service.js";
class AdminController {
    async getPendingOfflinePayments(req, res) {
        try {
            const payments = await adminService.getPendingOfflinePayments();
            return res.status(200).json({
                success: true,
                data: payments,
            });
        }
        catch (error) {
            console.error("Get Pending Offline Payments Error:", error);
            return res.status(500).json({
                success: false,
                message: error?.message ||
                    "Failed to fetch pending offline payments.",
            });
        }
    }
    async confirmOfflinePayment(req, res) {
        try {
            const bookingId = Array.isArray(req.params.bookingId)
                ? req.params.bookingId[0]
                : req.params.bookingId;
            if (!bookingId) {
                return res.status(400).json({
                    success: false,
                    message: "Booking ID is required.",
                });
            }
            const result = await adminService.confirmOfflinePayment(bookingId);
            return res.status(200).json({
                success: true,
                message: "Payment confirmed and membership activation email sent.",
                data: result,
            });
        }
        catch (error) {
            console.error("Confirm Offline Payment Error:", error);
            const message = error?.message ||
                "Failed to confirm offline payment.";
            if (message === "Booking not found.") {
                return res.status(404).json({
                    success: false,
                    message,
                });
            }
            if (message ===
                "This booking is not an offline payment." ||
                message ===
                    "This payment has already been confirmed." ||
                message ===
                    "Only pending payments can be confirmed.") {
                return res.status(400).json({
                    success: false,
                    message,
                });
            }
            return res.status(500).json({
                success: false,
                message,
            });
        }
    }
    async rejectOfflinePayment(req, res) {
        try {
            const bookingId = Array.isArray(req.params.bookingId)
                ? req.params.bookingId[0]
                : req.params.bookingId;
            if (!bookingId) {
                return res.status(400).json({
                    success: false,
                    message: "Booking ID is required.",
                });
            }
            const { reason } = req.body;
            const result = await adminService.rejectOfflinePayment(bookingId, reason);
            return res.status(200).json({
                success: true,
                message: "Offline payment rejected.",
                data: result,
            });
        }
        catch (error) {
            console.error("Reject Offline Payment Error:", error);
            const message = error?.message ||
                "Failed to reject offline payment.";
            if (message === "Booking not found.") {
                return res.status(404).json({
                    success: false,
                    message,
                });
            }
            return res.status(400).json({
                success: false,
                message,
            });
        }
    }
    async getPaymentDetails(req, res) {
        try {
            const bookingId = Array.isArray(req.params.bookingId)
                ? req.params.bookingId[0]
                : req.params.bookingId;
            if (!bookingId) {
                return res.status(400).json({
                    success: false,
                    message: "Booking ID is required.",
                });
            }
            const payment = await adminService.getPaymentDetails(bookingId);
            return res.status(200).json({
                success: true,
                data: payment,
            });
        }
        catch (error) {
            console.error("Get Payment Details Error:", error);
            if (error?.message === "Payment not found.") {
                return res.status(404).json({
                    success: false,
                    message: error.message,
                });
            }
            return res.status(500).json({
                success: false,
                message: "Failed to retrieve payment details.",
            });
        }
    }
}
export const adminController = new AdminController();
//# sourceMappingURL=admin.controller.js.map