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
  // =========================================================
  // CREATE BOOKING
  // =========================================================

  async createBooking(
    req: Request,
    res: Response
  ) {
    try {
      const booking =
        await bookingService.createBooking(
          req.body
        );

      return res.status(201).json({
        success: true,

        message:
          req.body.paymentMethod === "OFFLINE"
            ? "Offline booking created successfully."
            : "Booking created and payment initialized successfully.",

        data: booking,
      });
    } catch (error: any) {
      console.error(
        "Create Booking Error:",
        error
      );

      return res.status(400).json({
        success: false,

        message:
          error?.message ||
          "Failed to create booking.",
      });
    }
  }

  // =========================================================
  // GET BOOKING
  // =========================================================

  async getBooking(
    req: Request<{ bookingId: string }>,
    res: Response
  ) {
    try {
      const { bookingId } =
        req.params;

      if (
        !bookingId ||
        typeof bookingId !== "string"
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid booking ID.",
        });
      }

      const booking =
        await bookingService.getBookingById(
          bookingId
        );

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
      console.error(
        "Get Booking Error:",
        error
      );

      return res.status(500).json({
        success: false,

        message:
          error?.message ||
          "Failed to retrieve booking.",
      });
    }
  }

  // =========================================================
  // GET BOOKING CONFIRMATION
  // =========================================================

  async getBookingConfirmation(
    req: Request<ConfirmationParams>,
    res: Response
  ) {
    try {
      const { reference } =
        req.params;

      if (
        !reference ||
        typeof reference !== "string"
      ) {
        return res.status(400).json({
          success: false,
          message: "Payment reference is required.",
        });
      }

      const booking =
        await bookingService.getBookingConfirmation(
          reference
        );

      return res.status(200).json({
        success: true,

        message:
          "Booking retrieved successfully.",

        data: {
          booking,
        },
      });
    } catch (error: any) {
      console.error(
        "Get Booking Confirmation Error:",
        error
      );

      return res.status(404).json({
        success: false,

        message:
          error?.message ||
          "Booking not found.",
      });
    }
  }

  // =========================================================
  // GET MY BOOKINGS
  // =========================================================

    // =========================================================
  // CONTINUE GUEST BOOKING
  // =========================================================
  //
  // PUBLIC
  //
  // Used when the customer returns from Paymish with only
  // the payment reference.
  //
  // Generates a fresh bookingFlowToken so the customer can
  // continue Health Declaration, schedule and start-date
  // selection before creating an account.
  //
  // =========================================================

  async continueGuestBooking(
    req: Request<ConfirmationParams>,
    res: Response
  ) {
    try {
      const { reference } = req.params;

      if (
        !reference ||
        typeof reference !== "string"
      ) {
        return res.status(400).json({
          success: false,
          message: "Payment reference is required.",
        });
      }

      const result =
        await bookingService.continueGuestBooking(
          reference
        );

      return res.status(200).json({
        success: true,
        message:
          "Booking continuation session created successfully.",
        data: result,
      });
    } catch (error: any) {
      console.error(
        "Continue Guest Booking Error:",
        error
      );

      const message =
        error?.message ||
        "Unable to continue this booking.";

      if (
        message ===
        "Booking not found."
      ) {
        return res.status(404).json({
          success: false,
          message,
        });
      }

      if (
        message ===
        "Payment has not been completed for this booking."
      ) {
        return res.status(400).json({
          success: false,
          message,
        });
      }

      if (
        message ===
        "This booking has already been confirmed."
      ) {
        return res.status(409).json({
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
  
  async getMyBookings(
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

  // =========================================================
  // NEW:
  // SAVE HEALTH DECLARATION
  // =========================================================
  //
  // PUBLIC
  //
  // Customer has NOT created an account yet.
  //
  // Body:
  //
  // {
  //   "bookingFlowToken": "...",
  //   "accepted": true,
  //   "notes": "..."
  // }
  //
  // =========================================================

  async saveHealthDeclaration(
    req: Request,
    res: Response
  ) {
    try {
      const bookingId =
        String(req.params.bookingId);

      if (
        !bookingId ||
        bookingId === "undefined"
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid booking ID.",
        });
      }

      const {
        bookingFlowToken,
        accepted,
        notes,
      } = req.body;

      if (
        !bookingFlowToken ||
        typeof bookingFlowToken !== "string"
      ) {
        return res.status(401).json({
          success: false,

          message:
            "Booking continuation token is required.",
        });
      }

      if (accepted !== true) {
        return res.status(400).json({
          success: false,

          message:
            "You must accept the Health Declaration to continue.",
        });
      }

      const healthSafetyForm =
        await bookingService.saveHealthDeclaration(
          bookingId,
          bookingFlowToken,
          {
            accepted: true,
            notes:
              typeof notes === "string"
                ? notes
                : undefined,
          }
        );

      return res.status(200).json({
        success: true,

        message:
          "Health Declaration accepted successfully.",

        data: {
          healthSafetyForm,
        },
      });
    } catch (error: any) {
      console.error(
        "Save Health Declaration Error:",
        error
      );

      return res.status(400).json({
        success: false,

        message:
          error?.message ||
          "Unable to save Health Declaration.",
      });
    }
  }

  // =========================================================
  // NEW:
  // UPDATE BOOKING SCHEDULE
  // =========================================================
  //
  // PUBLIC
  //
  // Customer has not necessarily created an account yet.
  //
  // Body:
  //
  // {
  //   "bookingFlowToken": "...",
  //   "scheduleId": "..."
  // }
  //
  // =========================================================

  async updateBookingSchedule(
    req: Request,
    res: Response
  ) {
    try {
      const bookingId =
        String(req.params.bookingId);

      if (
        !bookingId ||
        bookingId === "undefined"
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid booking ID.",
        });
      }

      const {
        bookingFlowToken,
        scheduleId,
      } = req.body;

      if (
        !bookingFlowToken ||
        typeof bookingFlowToken !== "string"
      ) {
        return res.status(401).json({
          success: false,

          message:
            "Booking continuation token is required.",
        });
      }

      if (
        !scheduleId ||
        typeof scheduleId !== "string"
      ) {
        return res.status(400).json({
          success: false,
          message: "Schedule ID is required.",
        });
      }

      const booking =
        await bookingService.updateBookingSchedule(
          bookingId,
          bookingFlowToken,
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

  // =========================================================
  // NEW:
  // UPDATE BOOKING START DATE
  // =========================================================
  //
  // PUBLIC
  //
  // Body:
  //
  // {
  //   "bookingFlowToken": "...",
  //   "startDate": "2026-09-20"
  // }
  //
  // =========================================================

  async updateBookingStartDate(
    req: Request,
    res: Response
  ) {
    try {
      const bookingId =
        String(req.params.bookingId);

      if (
        !bookingId ||
        bookingId === "undefined"
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid booking ID.",
        });
      }

      const {
        bookingFlowToken,
        startDate,
      } = req.body;

      if (
        !bookingFlowToken ||
        typeof bookingFlowToken !== "string"
      ) {
        return res.status(401).json({
          success: false,

          message:
            "Booking continuation token is required.",
        });
      }

      if (
        !startDate ||
        typeof startDate !== "string"
      ) {
        return res.status(400).json({
          success: false,
          message: "Start date is required.",
        });
      }

      const booking =
        await bookingService.updateBookingStartDate(
          bookingId,
          bookingFlowToken,
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

  // =========================================================
  // NEW:
  // ATTACH BOOKING TO ACCOUNT
  // =========================================================
  //
  // AUTHENTICATED
  //
  // Called after registration/login.
  //
  // Body:
  //
  // {
  //   "bookingFlowToken": "..."
  // }
  //
  // =========================================================

  async attachBookingAccount(
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

      if (
        !bookingId ||
        bookingId === "undefined"
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid booking ID.",
        });
      }

      const {
        bookingFlowToken,
      } = req.body;

      if (
        !bookingFlowToken ||
        typeof bookingFlowToken !== "string"
      ) {
        return res.status(401).json({
          success: false,

          message:
            "Booking continuation token is required.",
        });
      }

      const booking =
        await bookingService.attachBookingAccount(
          bookingId,
          userId,
          bookingFlowToken
        );

      return res.status(200).json({
        success: true,

        message:
          "Booking successfully linked to your account.",

        data: {
          booking,
        },
      });
    } catch (error: any) {
      console.error(
        "Attach Booking Account Error:",
        error
      );

      return res.status(400).json({
        success: false,

        message:
          error?.message ||
          "Unable to attach booking to your account.",
      });
    }
  }

  // =========================================================
  // FINAL CONFIRMATION
  // =========================================================
  //
  // AUTHENTICATED
  //
  // =========================================================

  async confirmBooking(
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

      if (
        !bookingId ||
        bookingId === "undefined"
      ) {
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

  // =========================================================
  // LEGACY:
  // ASSIGN ALL SCHEDULES
  // =========================================================
  //
  // DO NOT USE FOR NEW FRONTEND.
  //
  // =========================================================

  async assignSchedules(
    req: Request,
    res: Response
  ) {
    try {
      const {
        bookingId,
      } = req.params;

      if (
        typeof bookingId !== "string" ||
        !bookingId.trim()
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid booking ID.",
        });
      }

      const userId =
        (req as any).user?.userId;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized.",
        });
      }

      const schedules =
        await bookingService.assignSchedules(
          bookingId,
          userId
        );

      return res.status(200).json({
        success: true,

        message:
          "Schedules assigned successfully.",

        data: schedules,
      });
    } catch (error: any) {
      console.error(
        "Assign Schedules Error:",
        error
      );

      return res.status(400).json({
        success: false,

        message:
          error?.message ||
          "Failed to assign schedules.",
      });
    }
  }

  // =========================================================
  // LEGACY:
  // HEALTH & SAFETY FORM
  // =========================================================
  //
  // Kept temporarily for old frontend compatibility.
  //
  // =========================================================

  async saveHealthSafetyForm(
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

      if (
        !bookingId ||
        bookingId === "undefined"
      ) {
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
          error?.message ||
          "Unable to save Health & Safety form.",
      });
    }
  }

  // =========================================================
  // LEGACY:
  // UPDATE BOOKING PREFERENCES
  // =========================================================

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

  // =========================================================
  // LEGACY:
  // UPDATE CLASS
  // =========================================================

  async updateBookingClass(
    req: Request,
    res: Response
  ) {
    try {
      const {
        bookingId,
      } = req.params;

      const {
        classId,
      } = req.body;

      if (
        typeof bookingId !== "string" ||
        !bookingId.trim()
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid booking ID.",
        });
      }

      if (
        typeof classId !== "string" ||
        !classId.trim()
      ) {
        return res.status(400).json({
          success: false,
          message: "Please select a class.",
        });
      }

      const userId =
        (req as any).user?.userId;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized.",
        });
      }

      const booking =
        await bookingService.updateBookingClass(
          bookingId,
          userId,
          classId
        );

      return res.status(200).json({
        success: true,

        message:
          "Class selected successfully.",

        data: {
          booking,
        },
      });
    } catch (error: any) {
      console.error(
        "Update Booking Class Error:",
        error
      );

      return res.status(400).json({
        success: false,

        message:
          error?.message ||
          "Failed to save selected class.",
      });
    }
  }
}

export default new BookingController();