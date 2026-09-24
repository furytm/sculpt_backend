import { Request, Response } from "express";
import bookingService from "./booking.service.js";

class BookingController {
  // =========================================================
  // CREATE BOOKING
  // =========================================================

  async createBooking(req: Request, res: Response) {
    try {
      const booking = await bookingService.createBooking(req.body);

      return res.status(201).json({
        success: true,
        message:
          req.body.paymentMethod === "OFFLINE"
            ? "Booking created successfully."
            : "Booking created and payment initialized successfully.",
        data: booking,
      });
    } catch (error: any) {
      console.error("Create Booking Error:", error);

      return res.status(400).json({
        success: false,
        message: error?.message || "Failed to create booking.",
      });
    }
  }

  // =========================================================
  // INITIALIZE PAYMENT
  // =========================================================

  async initializePayment(req: Request, res: Response) {
    try {
   const bookingId = String(req.params.bookingId);

      if (!bookingId) {
        return res.status(400).json({
          success: false,
          message: "Booking ID is required.",
        });
      }

const { bookingFlowToken } = req.body;

if (
  !bookingFlowToken ||
  typeof bookingFlowToken !== "string"
) {
  return res.status(401).json({
    success: false,
    message: "Booking continuation token is required.",
  });
}

const result = await bookingService.initializePayment(
  bookingId,
  bookingFlowToken
);

      return res.status(200).json({
        success: true,
        message: "Payment initialized successfully.",
        data: result,
      });
    } catch (error: any) {
      console.error("Initialize Payment Error:", error);

      return res.status(400).json({
        success: false,
        message: error?.message || "Failed to initialize payment.",
      });
    }
  }

  // =========================================================
  // GET BOOKING
  // =========================================================

  async getBooking(req: Request, res: Response) {
    try {
     const bookingId = String(req.params.bookingId);

      if (!bookingId) {
        return res.status(400).json({
          success: false,
          message: "Booking ID is required.",
        });
      }

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

  // =========================================================
  // GET CLASS AVAILABILITY
  // =========================================================
  //
  // Example:
  // GET /api/bookings/availability/reformer
  //
  // Optional:
  // ?startDate=2026-09-24&endDate=2026-10-24
  //
  // =========================================================

  async getClassAvailability(req: Request, res: Response) {
    try {
     const classId = String(req.params.classId);

      if (!classId) {
        return res.status(400).json({
          success: false,
          message: "Class ID is required.",
        });
      }

      const startDate =
        typeof req.query.startDate === "string"
          ? req.query.startDate
          : undefined;

      const endDate =
        typeof req.query.endDate === "string"
          ? req.query.endDate
          : undefined;

      const availability =
        await bookingService.getClassAvailability(
          classId,
          startDate,
          endDate
        );

      return res.status(200).json({
        success: true,
        data: availability,
      });
    } catch (error: any) {
      console.error("Get Class Availability Error:", error);

      return res.status(400).json({
        success: false,
        message:
          error?.message || "Failed to retrieve class availability.",
      });
    }
  }

  // =========================================================
  // GET SINGLE SESSION AVAILABILITY
  // =========================================================

  async getSessionAvailability(req: Request, res: Response) {
    try {
 const sessionId = String(req.params.sessionId);

      if (!sessionId) {
        return res.status(400).json({
          success: false,
          message: "Session ID is required.",
        });
      }

      const session =
        await bookingService.getSessionAvailability(sessionId);

      if (!session) {
        return res.status(404).json({
          success: false,
          message: "Class session not found.",
        });
      }

      return res.status(200).json({
        success: true,
        data: session,
      });
    } catch (error: any) {
      console.error("Get Session Availability Error:", error);

      return res.status(400).json({
        success: false,
        message:
          error?.message || "Failed to retrieve session availability.",
      });
    }
  }

  // =========================================================
  // GET BOOKING CONFIRMATION
  // =========================================================

  async getBookingConfirmation(req: Request, res: Response) {
    try {
   const reference = String(req.params.reference);

      if (!reference) {
        return res.status(400).json({
          success: false,
          message: "Payment reference is required.",
        });
      }

      const booking =
        await bookingService.getBookingConfirmation(reference);

      return res.status(200).json({
        success: true,
        message: "Booking retrieved successfully.",
        data: {
          booking,
        },
      });
    } catch (error: any) {
      console.error("Get Booking Confirmation Error:", error);

      return res.status(404).json({
        success: false,
        message: error?.message || "Booking not found.",
      });
    }
  }

  // =========================================================
  // CONTINUE GUEST BOOKING
  // =========================================================

  async continueGuestBooking(req: Request, res: Response) {
    try {
const reference = String(req.params.reference);

      if (!reference) {
        return res.status(400).json({
          success: false,
          message: "Payment reference is required.",
        });
      }

      const result =
        await bookingService.continueGuestBooking(reference);

      return res.status(200).json({
        success: true,
        message:
          "Booking continuation session created successfully.",
        data: result,
      });
    } catch (error: any) {
      console.error("Continue Guest Booking Error:", error);

      return res.status(400).json({
        success: false,
        message:
          error?.message ||
          "Unable to continue this booking.",
      });
    }
  }

  // =========================================================
  // GET MY BOOKINGS
  // =========================================================

  async getMyBookings(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.userId;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized.",
        });
      }

      const bookings =
        await bookingService.getMyBookings(userId);

      return res.status(200).json({
        success: true,
        data: {
          bookings,
        },
      });
    } catch (error: any) {
      console.error("Get My Bookings Error:", error);

      return res.status(500).json({
        success: false,
        message:
          error?.message ||
          "Failed to retrieve your bookings.",
      });
    }
  }

  // =========================================================
  // SAVE HEALTH DECLARATION
  // =========================================================

  async saveHealthDeclaration(
    req: Request,
    res: Response
  ) {
    try {
    const bookingId = String(req.params.bookingId);

      if (!bookingId) {
        return res.status(400).json({
          success: false,
          message: "Booking ID is required.",
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
  // ATTACH BOOKING TO ACCOUNT
  // =========================================================

  async attachBookingAccount(
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

      const { bookingFlowToken } = req.body;

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
  // CONFIRM BOOKING
  // =========================================================

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
        message: "Booking confirmed successfully.",
        data: {
          booking,
        },
      });
    } catch (error: any) {
      console.error("Confirm Booking Error:", error);

      return res.status(400).json({
        success: false,
        message:
          error?.message ||
          "Unable to confirm booking.",
      });
    }
  }

  // =========================================================
  // BOOK A SESSION USING EXISTING MEMBERSHIP
  // =========================================================

  async bookMemberSession(
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

      const { classSessionId } = req.body;

      if (
        !classSessionId ||
        typeof classSessionId !== "string"
      ) {
        return res.status(400).json({
          success: false,
          message: "Class session ID is required.",
        });
      }

      const booking =
        await bookingService.bookMemberSession(
          userId,
          classSessionId
        );

      return res.status(201).json({
        success: true,
        message: "Class session booked successfully.",
        data: {
          booking,
        },
      });
    } catch (error: any) {
      console.error(
        "Book Member Session Error:",
        error
      );

      return res.status(400).json({
        success: false,
        message:
          error?.message ||
          "Unable to book class session.",
      });
    }
  }

  // =========================================================
  // MEMBERSHIP CREDIT SUMMARY
  // =========================================================

  async getMembershipCreditSummary(
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

      const summary =
        await bookingService.getMembershipCreditSummary(
          userId
        );

      return res.status(200).json({
        success: true,
        data: summary,
      });
    } catch (error: any) {
      console.error(
        "Get Membership Credit Summary Error:",
        error
      );

      return res.status(400).json({
        success: false,
        message:
          error?.message ||
          "Unable to retrieve membership credits.",
      });
    }
  }

    async cancelBooking(req: Request, res: Response) {
    try {
    
   const bookingId = String(req.params.bookingId);

      const userId = req.user?.userId;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required.",
        });
      }

      if (!bookingId) {
        return res.status(400).json({
          success: false,
          message: "Booking ID is required.",
        });
      }

      const result = await bookingService.cancelBooking(
        bookingId,
        userId
      );

      return res.status(200).json({
        success: true,
        ...result,
      });
    } catch (error: any) {
      console.error("Cancel booking error:", error);

      return res.status(400).json({
        success: false,
        message:
          error?.message || "Failed to cancel booking.",
      });
    }
  }
}

export default new BookingController();