import { Request, Response } from "express";
import bookingService from "./booking.service.js";

interface ConfirmationParams {
  reference: string;
}

class BookingController {

  
  async createBooking(req: Request, res: Response) {
    try {
      const result = await bookingService.createBooking(req.body);

      return res.status(201).json({
        success: true,
        message: "Booking created. Redirect the user to Paymish to complete payment.",
        data: result,
      });
    } catch (error: any) {
      console.error("Create Booking Error:", error);

      return res.status(400).json({
        success: false,
        message: error?.message || "Failed to create booking.",
        error,
      });
    }
  }

 

async getBooking(
  req: Request<{ bookingId: string }>,
  res: Response
) {
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
  } catch (error: any) {
    console.error("Get Booking Error:", error);

    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to retrieve booking.",
    });
  }

  
}


async getBookingConfirmation(
  req: Request<ConfirmationParams>,
  res: Response
) {
  try {
    const booking = await bookingService.getBookingConfirmation(
      req.params.reference
    );

    return res.status(200).json({
      success: true,
      message: "Booking retrieved successfully.",
      data: {
        booking,
      },
    });
  } catch (error: any) {
    return res.status(404).json({
      success: false,
      message: error.message,
    });
  }
}

async getMyBookings(
  req: Request,
  res: Response
) {
  try {
    const userId = (req as any).user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    const bookings =
      await bookingService.getMyBookings(
        userId
      );

    return res.status(200).json({
      success: true,
      data: {
        bookings,
      },
    });
  } catch (error: any) {
    console.error(
      "Get My Bookings Error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error?.message ||
        "Failed to retrieve your bookings.",
    });
  }
}
}

export default new BookingController();