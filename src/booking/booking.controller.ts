import { Request, Response } from "express";
import bookingService from "./booking.service.js";
import {
  UpdateBookingPreferencesDto,
} from "./booking.types.js";

import {
  updateBookingPreferencesSchema,
} from "./booking.validation.js";

interface ConfirmationParams {
  reference: string;
}

class BookingController {

  
async createBooking(req: Request, res: Response) {
  try {
const userId = req.user.userId;

const result = await bookingService.createBooking(
  req.body,
  userId
);

    return res.status(201).json({
      success: true,
      message:
        "Booking created. Redirect the user to Paymish to complete payment.",
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

async updateBookingPreferences(
  req: Request<
    { bookingId: string },
    {},
    UpdateBookingPreferencesDto
  >,
  res: Response
) {
  try {
    const userId =
      (req as any).user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    const {
      error,
      value,
    } =
      updateBookingPreferencesSchema.validate(
        req.body
      );

    if (error) {
      return res.status(400).json({
        success: false,
        message:
          error.details[0].message,
      });
    }

    const booking =
      await bookingService.updateBookingPreferences(
        req.params.bookingId,
        userId,
        value
      );

    return res.status(200).json({
      success: true,
      message:
        "Booking preferences saved successfully.",
      data: {
        booking,
      },
    });
  } catch (error: any) {
    console.error(
      "Update Booking Preferences Error:",
      error
    );

    return res.status(400).json({
      success: false,
      message:
        error?.message ||
        "Failed to save booking preferences.",
    });
  }
}

/**
 * POST /api/bookings/:bookingId/confirm
 *
 * Confirm an existing paid booking.
 */
async confirmBooking(
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

const bookingId = String(req.params.bookingId);

    if (!bookingId) {
      return res.status(400).json({
        success: false,
        message: "Booking ID is required.",
      });
    }

    const booking =
      await bookingService.confirmBooking(
        bookingId,
        userId
      );

    return res.status(200).json({
      success: true,
      message:
        "Booking confirmed successfully.",
      data: {
        booking,
      },
    });
  } catch (error: any) {
    console.error(
      "Confirm Booking Error:",
      error
    );

    return res.status(400).json({
      success: false,
      message:
        error?.message ||
        "Unable to confirm booking.",
    });
  }
}

async saveHealthSafetyForm(
  req: Request,
  res: Response
) {
  try {
    const userId =
      (req as any).user.userId;

    const bookingId =
      req.params.bookingId;

    if (typeof bookingId !== "string") {
      return res.status(400).json({
        success: false,
        message: "Invalid booking ID.",
      });
    }

    const result =
      await bookingService.saveHealthSafetyForm(
        bookingId,
        userId,
        req.body
      );

    return res.status(200).json({
      success: true,
      message:
        "Health & Safety form saved successfully.",
      data: {
        healthSafetyForm: result,
      },
    });
  } catch (error: any) {
    console.error(
      "Health Safety Form Error:",
      error
    );

    return res.status(400).json({
      success: false,
      message:
        error.message ||
        "Unable to save Health & Safety form.",
    });
  }
}

/**
 * PATCH /api/bookings/:bookingId/start-date
 *
 * Save the member's selected start date.
 */
async updateBookingStartDate(
  req: Request,
  res: Response
) {
  try {
    const userId =
      (req as any).user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    const bookingId =
      String(req.params.bookingId);

    const { startDate } = req.body;

    if (!startDate) {
      return res.status(400).json({
        success: false,
        message:
          "Start date is required.",
      });
    }

    const booking =
      await bookingService.updateBookingStartDate(
        bookingId,
        userId,
        startDate
      );

    return res.status(200).json({
      success: true,
      message:
        "Start date saved successfully.",
      data: {
        booking,
      },
    });
  } catch (error: any) {
    console.error(
      "Update Booking Start Date Error:",
      error
    );

    return res.status(400).json({
      success: false,
      message:
        error?.message ||
        "Failed to save start date.",
    });
  }
}

/**
 * PATCH /api/bookings/:bookingId/schedule
 *
 * Save the schedule selected by the member.
 */
async updateBookingSchedule(
  req: Request,
  res: Response
) {
  try {
    const userId =
      (req as any).user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    const bookingId =
      String(req.params.bookingId);

    const { scheduleId } = req.body;

    if (!scheduleId) {
      return res.status(400).json({
        success: false,
        message: "Schedule ID is required.",
      });
    }

    const booking =
      await bookingService.updateBookingSchedule(
        bookingId,
        userId,
        scheduleId
      );

    return res.status(200).json({
      success: true,
      message:
        "Schedule selected successfully.",
      data: {
        booking,
      },
    });
  } catch (error: any) {
    console.error(
      "Update Booking Schedule Error:",
      error
    );

    return res.status(400).json({
      success: false,
      message:
        error?.message ||
        "Failed to select schedule.",
    });
  }
}

async updateBookingClass(req: Request, res: Response) {
  try {
    const { bookingId } = req.params;
    const { classId } = req.body;

    if (typeof bookingId !== "string") {
      return res.status(400).json({
        success: false,
        message: "Invalid booking ID.",
      });
    }

  const userId = req.user.userId;

    const booking = await bookingService.updateBookingClass(
      bookingId,
      userId,
      classId
    );

    return res.status(200).json({
      success: true,
      message: "Class selected successfully.",
      data: {
        booking,
      },
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Unable to select class.",
    });
  }
}
}

export default new BookingController();