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
    async resendRegistrationEmail(req, res) {
        try {
            const email = typeof req.body?.email === "string"
                ? req.body.email.trim().toLowerCase()
                : "";
            if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                return res.status(400).json({
                    success: false,
                    message: "Please provide a valid email address.",
                });
            }
            const result = await adminService.resendRegistrationEmail(email);
            return res.status(200).json(result);
        }
        catch (error) {
            console.error("Resend registration email error:", error);
            return res.status(500).json({
                success: false,
                message: "Unable to process your request right now.",
            });
        }
    }
    async getAllBookings(req, res) {
        try {
            const bookings = await adminService.getAllBookings();
            return res.status(200).json({
                success: true,
                message: "All bookings retrieved successfully.",
                data: bookings,
            });
        }
        catch (error) {
            console.error("Get All Admin Bookings Error:", error);
            return res.status(500).json({
                success: false,
                message: error?.message ||
                    "Failed to retrieve bookings.",
            });
        }
    }
    async getTutorSchedule(req, res) {
        try {
            const { startDate, endDate } = req.query;
            if (typeof startDate !== "string" ||
                typeof endDate !== "string") {
                return res.status(400).json({
                    success: false,
                    message: "startDate and endDate are required in YYYY-MM-DD format.",
                });
            }
            const data = await adminService.getTutorSchedule(startDate, endDate);
            return res.status(200).json({
                success: true,
                message: "Tutor schedule retrieved successfully.",
                data,
            });
        }
        catch (error) {
            console.error("Get Tutor Schedule Error:", error);
            const message = error?.message || "Failed to retrieve tutor schedule.";
            if (message.includes("Dates must") ||
                message.includes("Invalid calendar date") ||
                message.includes("cannot be after")) {
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
    async getBookingById(req, res) {
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
            const booking = await adminService.getBookingById(bookingId);
            return res.status(200).json({
                success: true,
                message: "Booking retrieved successfully.",
                data: booking,
            });
        }
        catch (error) {
            console.error("Get Admin Booking Error:", error);
            if (error?.message === "Booking not found.") {
                return res.status(404).json({
                    success: false,
                    message: error.message,
                });
            }
            return res.status(500).json({
                success: false,
                message: error?.message ||
                    "Failed to retrieve booking.",
            });
        }
    }
    async cancelBooking(req, res) {
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
            const result = await adminService.cancelBooking(bookingId);
            return res.status(200).json({
                success: true,
                message: "Booking cancelled successfully.",
                data: result,
            });
        }
        catch (error) {
            console.error("Admin Cancel Booking Error:", error);
            const message = error?.message ||
                "Failed to cancel booking.";
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
    async getDashboard(req, res) {
        try {
            const dashboard = await adminService.getDashboard();
            return res.status(200).json({
                success: true,
                message: "Admin dashboard retrieved successfully.",
                data: dashboard,
            });
        }
        catch (error) {
            console.error("Get Admin Dashboard Error:", error);
            return res.status(500).json({
                success: false,
                message: "Failed to retrieve admin dashboard.",
            });
        }
    }
    async deleteBooking(req, res) {
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
            const result = await adminService.deleteBooking(bookingId);
            return res.status(200).json({
                success: true,
                message: "Booking deleted successfully.",
                data: result,
            });
        }
        catch (error) {
            console.error("Delete Admin Booking Error:", error);
            if (error?.message === "Booking not found.") {
                return res.status(404).json({
                    success: false,
                    message: error.message,
                });
            }
            return res.status(500).json({
                success: false,
                message: error?.message ||
                    "Failed to delete booking.",
            });
        }
    }
    async deleteMember(req, res) {
        try {
            const memberId = Array.isArray(req.params.memberId)
                ? req.params.memberId[0]
                : req.params.memberId;
            if (!memberId) {
                return res.status(400).json({
                    success: false,
                    message: "Member ID is required.",
                });
            }
            const result = await adminService.deleteMember(memberId);
            return res.status(200).json({
                success: true,
                message: "Member deleted successfully.",
                data: result,
            });
        }
        catch (error) {
            console.error("Delete Admin Member Error:", error);
            const message = error?.message || "Failed to delete member.";
            if (message === "Member not found.") {
                return res.status(404).json({
                    success: false,
                    message,
                });
            }
            if (message === "Only member accounts can be deleted.") {
                return res.status(403).json({
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
    async createOfflineMember(req, res) {
        try {
            const { fullName, email, phone, membershipId, remainingCredits, } = req.body;
            if (!membershipId) {
                return res.status(400).json({
                    success: false,
                    message: "Membership ID is required.",
                });
            }
            if (remainingCredits !== undefined &&
                (typeof remainingCredits !== "number" ||
                    !Number.isInteger(remainingCredits) ||
                    remainingCredits < 0)) {
                return res.status(400).json({
                    success: false,
                    message: "Remaining credits must be a non-negative integer.",
                });
            }
            const result = await adminService.createOfflineMember({
                fullName,
                email,
                phone,
                membershipId,
                remainingCredits,
            });
            return res.status(201).json({
                success: true,
                message: email
                    ? "Offline member created and activation email sent."
                    : "Offline member created. No email was supplied, so use the activation link to complete registration.",
                data: result,
            });
        }
        catch (error) {
            console.error("Create Offline Member Error:", error);
            const message = error?.message || "Failed to create offline member.";
            if (message === "Membership ID is required." ||
                message === "Membership not found." ||
                message === "This membership is not active." ||
                message.startsWith("Remaining credits")) {
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
    async getAllMembers(req, res) {
        try {
            const members = await adminService.getAllMembers();
            return res.status(200).json({
                success: true,
                message: 'Members retrieved successfully.',
                data: {
                    members,
                },
            });
        }
        catch (error) {
            console.error('Get all members error:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to retrieve members.',
            });
        }
    }
    async getMemberClasses(req, res) {
        try {
            const memberId = Array.isArray(req.params.userId)
                ? req.params.userId[0]
                : req.params.userId;
            if (!memberId) {
                return res.status(400).json({
                    success: false,
                    message: 'Member ID is required.',
                });
            }
            const result = await adminService.getMemberClasses(memberId);
            return res.status(200).json({
                success: true,
                message: 'Member classes retrieved successfully.',
                data: result,
            });
        }
        catch (error) {
            console.error('Get Member Classes Error:', error);
            if (error?.message === 'Member not found.') {
                return res.status(404).json({
                    success: false,
                    message: error.message,
                });
            }
            return res.status(500).json({
                success: false,
                message: error?.message || 'Failed to retrieve member classes.',
            });
        }
    }
    async getPendingOfflineMembershipPurchases(req, res) {
        try {
            const purchases = await adminService
                .getPendingOfflineMembershipPurchases();
            return res.status(200).json({
                success: true,
                data: purchases,
            });
        }
        catch (error) {
            console.error(error);
            return res.status(500).json({
                success: false,
                message: error?.message ||
                    "Failed to fetch pending membership purchases.",
            });
        }
    }
    async confirmOfflineMembershipPurchase(req, res) {
        try {
            const purchaseId = Array.isArray(req.params.purchaseId)
                ? req.params.purchaseId[0]
                : req.params.purchaseId;
            if (!purchaseId) {
                return res.status(400).json({
                    success: false,
                    message: "Purchase ID is required.",
                });
            }
            const result = await adminService
                .confirmOfflineMembershipPurchase(purchaseId);
            return res.status(200).json({
                success: true,
                message: "Offline membership payment confirmed.",
                data: result,
            });
        }
        catch (error) {
            console.error(error);
            return res.status(400).json({
                success: false,
                message: error?.message ||
                    "Failed to confirm membership purchase.",
            });
        }
    }
    async rejectOfflineMembershipPurchase(req, res) {
        try {
            const purchaseId = Array.isArray(req.params.purchaseId)
                ? req.params.purchaseId[0]
                : req.params.purchaseId;
            const { reason } = req.body;
            if (!purchaseId) {
                return res.status(400).json({
                    success: false,
                    message: "Purchase ID is required.",
                });
            }
            const result = await adminService
                .rejectOfflineMembershipPurchase(purchaseId, reason);
            return res.status(200).json({
                success: true,
                message: "Membership purchase rejected.",
                data: result,
            });
        }
        catch (error) {
            console.error(error);
            return res.status(400).json({
                success: false,
                message: error?.message ||
                    "Failed to reject membership purchase.",
            });
        }
    }
    async getAllMembershipPurchases(req, res) {
        try {
            const purchases = await adminService.getAllMembershipPurchases();
            return res.status(200).json({
                success: true,
                message: "Membership purchases retrieved successfully.",
                data: purchases,
            });
        }
        catch (error) {
            return res.status(500).json({
                success: false,
                message: "Failed to retrieve membership purchases.",
            });
        }
    }
    async addMembershipToMember(req, res) {
        try {
            const { membershipId, totalCredits, usedCredits, startDate, } = req.body;
            const memberId = req.params.memberId;
            if (typeof memberId !== "string") {
                return res.status(400).json({
                    success: false,
                    message: "Invalid member ID.",
                });
            }
            if (!membershipId) {
                return res.status(400).json({
                    success: false,
                    message: "Membership ID is required.",
                });
            }
            if (totalCredits !== undefined &&
                (typeof totalCredits !== "number" ||
                    !Number.isInteger(totalCredits) ||
                    totalCredits < 1)) {
                return res.status(400).json({
                    success: false,
                    message: "Total credits must be a positive integer.",
                });
            }
            if (usedCredits !== undefined &&
                (typeof usedCredits !== "number" ||
                    !Number.isInteger(usedCredits) ||
                    usedCredits < 0)) {
                return res.status(400).json({
                    success: false,
                    message: "Used credits must be a non-negative integer.",
                });
            }
            const membership = await adminService.addMembershipToMember({
                memberId,
                membershipId,
                totalCredits,
                usedCredits,
                startDate,
            });
            return res.status(201).json({
                success: true,
                message: "Membership added to member successfully.",
                data: membership,
            });
        }
        catch (error) {
            console.error("Add Membership To Member Error:", error);
            const message = error?.message || "Failed to add membership to member.";
            const badRequestErrors = [
                "Registered member not found.",
                "Membership not found.",
                "This membership is not active.",
                "Credits cannot be set for an unlimited membership.",
                "Total credits must be a positive integer.",
                "Used credits must be between 0 and total credits.",
                "Invalid membership start date.",
            ];
            if (badRequestErrors.includes(message)) {
                return res.status(message === "Registered member not found." ||
                    message === "Membership not found."
                    ? 404
                    : 400).json({
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
}
export const adminController = new AdminController();
//# sourceMappingURL=admin.controller.js.map