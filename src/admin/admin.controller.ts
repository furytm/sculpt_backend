import { Request, Response } from "express";
import { adminService } from "./admin.service.js";

class AdminController {
  async getPendingOfflinePayments(
    req: Request,
    res: Response
  ) {
    try {
      const payments =
        await adminService.getPendingOfflinePayments();

      return res.status(200).json({
        success: true,
        data: payments,
      });
    } catch (error: any) {
      console.error(
        "Get Pending Offline Payments Error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          error?.message ||
          "Failed to fetch pending offline payments.",
      });
    }
  }

async confirmOfflinePayment(req: Request, res: Response) {
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

    const result =
      await adminService.confirmOfflinePayment(bookingId);

    return res.status(200).json({
      success: true,
      message:
        "Payment confirmed and membership activation email sent.",
      data: result,
    });
  } catch (error: any) {
    console.error(
      "Confirm Offline Payment Error:",
      error
    );

    const message =
      error?.message ||
      "Failed to confirm offline payment.";

    if (message === "Booking not found.") {
      return res.status(404).json({
        success: false,
        message,
      });
    }

    if (
      message ===
        "This booking is not an offline payment." ||
      message ===
        "This payment has already been confirmed." ||
      message ===
        "Only pending payments can be confirmed."
    ) {
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


async resendRegistrationEmail(req: Request, res: Response) {
  try {
    const email =
      typeof req.body?.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address.",
      });
    }

    const result =
      await adminService.resendRegistrationEmail(email);

    return res.status(200).json(result);
  } catch (error) {
    console.error("Resend registration email error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to process your request right now.",
    });
  }
}

async getAllBookings(
  req: Request,
  res: Response
) {
  try {
    const bookings =
      await adminService.getAllBookings();

    return res.status(200).json({
      success: true,
      message:
        "All bookings retrieved successfully.",
      data: bookings,
    });
  } catch (error: any) {
    console.error(
      "Get All Admin Bookings Error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error?.message ||
        "Failed to retrieve bookings.",
    });
  }
}

  async getBookingById(req: Request, res: Response) {
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

      const booking =
        await adminService.getBookingById(bookingId);

      return res.status(200).json({
        success: true,
        message: "Booking retrieved successfully.",
        data: booking,
      });
    } catch (error: any) {
      console.error(
        "Get Admin Booking Error:",
        error
      );

      if (error?.message === "Booking not found.") {
        return res.status(404).json({
          success: false,
          message: error.message,
        });
      }

      return res.status(500).json({
        success: false,
        message:
          error?.message ||
          "Failed to retrieve booking.",
      });
    }
  }

  async cancelBooking(req: Request, res: Response) {
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

      const result =
        await adminService.cancelBooking(bookingId);

      return res.status(200).json({
        success: true,
        message: "Booking cancelled successfully.",
        data: result,
      });
    } catch (error: any) {
      console.error(
        "Admin Cancel Booking Error:",
        error
      );

      const message =
        error?.message ||
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
async rejectOfflinePayment(req: Request, res: Response) {
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

    const result =
      await adminService.rejectOfflinePayment(
        bookingId,
        reason
      );

    return res.status(200).json({
      success: true,
      message: "Offline payment rejected.",
      data: result,
    });
  } catch (error: any) {
    console.error(
      "Reject Offline Payment Error:",
      error
    );

    const message =
      error?.message ||
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

async getPaymentDetails(req: Request, res: Response) {
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

    const payment =
      await adminService.getPaymentDetails(
        bookingId
      );

    return res.status(200).json({
      success: true,
      data: payment,
    });
  } catch (error: any) {
    console.error(
      "Get Payment Details Error:",
      error
    );

    if (error?.message === "Payment not found.") {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message:
        "Failed to retrieve payment details.",
    });
  }
}


async getDashboard(req: Request, res: Response) {
  try {
    const dashboard = await adminService.getDashboard();

    return res.status(200).json({
      success: true,
      message: "Admin dashboard retrieved successfully.",
      data: dashboard,
    });
  } catch (error) {
    console.error("Get Admin Dashboard Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve admin dashboard.",
    });
  }
}

async deleteBooking(req: Request, res: Response) {
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

    const result =
      await adminService.deleteBooking(bookingId);

    return res.status(200).json({
      success: true,
      message: "Booking deleted successfully.",
      data: result,
    });
  } catch (error: any) {
    console.error(
      "Delete Admin Booking Error:",
      error
    );

    if (error?.message === "Booking not found.") {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message:
        error?.message ||
        "Failed to delete booking.",
    });
  }
}


async deleteMember(req: Request, res: Response) {
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
  } catch (error: any) {
    console.error("Delete Admin Member Error:", error);

    const message =
      error?.message || "Failed to delete member.";

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



async createOfflineMember(req: Request, res: Response) {
  try {
    const {
      fullName,
      email,
      phone,
      membershipId,
      remainingCredits,
    } = req.body;

    if (!membershipId) {
      return res.status(400).json({
        success: false,
        message: "Membership ID is required.",
      });
    }

    if (
      remainingCredits !== undefined &&
      (
        typeof remainingCredits !== "number" ||
        !Number.isInteger(remainingCredits) ||
        remainingCredits < 0
      )
    ) {
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
  } catch (error: any) {
    console.error("Create Offline Member Error:", error);

    const message =
      error?.message || "Failed to create offline member.";

    if (
      message === "Membership ID is required." ||
      message === "Membership not found." ||
      message === "This membership is not active." ||
      message.startsWith("Remaining credits") 
    ) {
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



async getAllMembers(req: Request, res: Response) {
  try {
    const members = await adminService.getAllMembers();

    return res.status(200).json({
      success: true,
      message: 'Members retrieved successfully.',
      data: {
        members,
      },
    });
  } catch (error) {
    console.error('Get all members error:', error);

    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve members.',
    });
  }
}


async getMemberClasses(req: Request, res: Response) {
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
  } catch (error: any) {
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
}

export const adminController =
  new AdminController();