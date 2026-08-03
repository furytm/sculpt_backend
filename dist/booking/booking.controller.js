import bookingService from "./booking.service.js";
class BookingController {
    async createBooking(req, res) {
        try {
            const result = await bookingService.createBooking(req.body);
            return res.status(201).json({
                success: true,
                message: "Booking created. Redirect the user to Paymish to complete payment.",
                data: result,
            });
        }
        catch (error) {
            console.error("Create Booking Error:", error);
            return res.status(400).json({
                success: false,
                message: error?.message || "Failed to create booking.",
                error,
            });
        }
    }
    async getBooking(req, res) {
        try {
            const { bookingId } = req.params;
            const booking = await bookingService.getBookingById(bookingId);
            if (!booking) {
                return res.status(404).json({
                    success: false,
                    message: "Booking not found.",
                });
            }
            return res.status(200).json({
                success: true,
                data: booking,
            });
        }
        catch (error) {
            console.error("Get Booking Error:", error);
            return res.status(500).json({
                success: false,
                message: error?.message || "Failed to retrieve booking.",
            });
        }
    }
    async getBookingConfirmation(req, res) {
        try {
            const booking = await bookingService.getBookingConfirmation(req.params.reference);
            return res.status(200).json({
                success: true,
                message: "Booking retrieved successfully.",
                data: {
                    booking,
                },
            });
        }
        catch (error) {
            return res.status(404).json({
                success: false,
                message: error.message,
            });
        }
    }
}
export default new BookingController();
//# sourceMappingURL=booking.controller.js.map