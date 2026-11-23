import { Request, Response } from "express";
import adminSessionService from "./admin-session.service.js";

class AdminSessionController {
  async getSessions(req: Request, res: Response) {
    try {
      const { classId, status, fromDate, toDate } = req.query;

      const sessions = await adminSessionService.getSessions({
        classId:
          typeof classId === "string"
            ? classId
            : undefined,

        status:
          typeof status === "string" &&
          ["OPEN", "FULL", "CANCELLED", "COMPLETED"].includes(
            status
          )
            ? status as
                | "OPEN"
                | "FULL"
                | "CANCELLED"
                | "COMPLETED"
            : undefined,

        fromDate:
          typeof fromDate === "string"
            ? new Date(fromDate)
            : undefined,

        toDate:
          typeof toDate === "string"
            ? new Date(toDate)
            : undefined,
      });

      return res.status(200).json({
        success: true,
        data: sessions,
      });
    } catch (error: any) {
      console.error(
        "Get admin sessions error:",
        error
      );

      return res.status(400).json({
        success: false,
        message:
          error?.message ||
          "Failed to fetch class sessions.",
      });
    }
  }

  async getSession(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;

      if (!sessionId) {
        return res.status(400).json({
          success: false,
          message: "Session ID is required.",
        });
      }

      const session =
        await adminSessionService.getSessionById(
          String(sessionId)
        );

      return res.status(200).json({
        success: true,
        data: session,
      });
    } catch (error: any) {
      console.error(
        "Get admin session error:",
        error
      );

      return res.status(400).json({
        success: false,
        message:
          error?.message ||
          "Failed to fetch class session.",
      });
    }
  }

  async cancelSession(req: Request, res: Response) {
    try {
       const sessionId = String(req.params.sessionId);

      if (!sessionId) {
        return res.status(400).json({
          success: false,
          message: "Session ID is required.",
        });
      }

      const result =
        await adminSessionService.cancelSession(
          sessionId
        );

      return res.status(200).json({
        success: true,
        ...result,
      });
    } catch (error: any) {
      console.error(
        "Cancel admin session error:",
        error
      );

      return res.status(400).json({
        success: false,
        message:
          error?.message ||
          "Failed to cancel class session.",
      });
    }
  }

  async reopenSession(req: Request, res: Response) {
    try {

 const sessionId = String(req.params.sessionId);
      if (!sessionId) {
        return res.status(400).json({
          success: false,
          message: "Session ID is required.",
        });
      }

      const result =
        await adminSessionService.reopenSession(
          sessionId
        );

      return res.status(200).json({
        success: true,
        ...result,
      });
    } catch (error: any) {
      console.error(
        "Reopen admin session error:",
        error
      );

      return res.status(400).json({
        success: false,
        message:
          error?.message ||
          "Failed to reopen class session.",
      });
    }
  }

  
async addOfflineAttendee(req: Request, res: Response) {
  try {
    const sessionId = String(req.params.sessionId ?? "");
    const body = req.body ?? {};
    const {
      fullName,
      email,
      phone,
      amount,
      paymentStatus,
      bookingType,
    } = body;

    // The catalogue plan is the attendee's class type and rate (the
    // booking needs one for GROUP/PRIVATE capacity). `ratePlanId` is
    // the clearer name; `membershipId` is still accepted.
    const ratePlanId = body.ratePlanId ?? body.membershipId;

    if (
      typeof fullName !== "string" ||
      typeof ratePlanId !== "string" ||
      !ratePlanId
    ) {
      return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "Attendee name and class type/rate are required.",
      });
    }

    for (const [field, value] of [["email", email], ["phone", phone]] as const) {
      if (value !== undefined && value !== null && typeof value !== "string") {
        return res.status(400).json({
          success: false,
          code: "VALIDATION_ERROR",
          message: `The attendee's ${field} must be text.`,
        });
      }
    }

    if (
      bookingType !== undefined &&
      bookingType !== "GROUP" &&
      bookingType !== "PRIVATE"
    ) {
      return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "Class type must be GROUP or PRIVATE.",
      });
    }

    // An offline attendee is recorded as paid. A PENDING booking would
    // not hold a seat (capacity counts CONFIRMED bookings only).
    if (paymentStatus !== undefined && paymentStatus !== "PAID") {
      return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message:
          "Offline attendees are recorded as paid. Take payment before adding them to the session.",
      });
    }

    if (
      amount !== undefined &&
      (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0)
    ) {
      return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "Amount must be a non-negative whole number.",
      });
    }

    const attendee =
      await adminSessionService.addOfflineAttendee(
        sessionId,
        {
          fullName,
          email,
          phone,
          membershipId: ratePlanId,
          amount,
          bookingType,
        }
      );

    return res.status(201).json({
      success: true,
      message: "Offline session attendee recorded successfully.",
      data: attendee,
    });
  } catch (error: any) {
    return res.status(error?.status ?? 400).json({
      success: false,
      ...(error?.code ? { code: error.code } : {}),
      message:
        error?.message || "Failed to add offline attendee.",
    });
  }
}

/**
 * POST /api/admin/sessions/:sessionId/members
 * Body: { userId, mode: "USE_CREDIT" | "PAID_OFFLINE", bookingType?,
 *         ratePlanId? (PAID_OFFLINE), amount? (PAID_OFFLINE) }
 */
async addMemberToSession(req: Request, res: Response) {
  const sessionId = String(req.params.sessionId ?? "");
  const { userId, mode, bookingType, ratePlanId, amount } = req.body ?? {};
  const invalid = (message: string) =>
    res.status(400).json({ success: false, code: "VALIDATION_ERROR", message });

  if (typeof userId !== "string" || !userId) {
    return invalid("Select a registered member.");
  }
  if (mode !== "USE_CREDIT" && mode !== "PAID_OFFLINE") {
    return invalid("Choose how the booking is paid: USE_CREDIT or PAID_OFFLINE.");
  }
  if (bookingType !== undefined && bookingType !== "GROUP" && bookingType !== "PRIVATE") {
    return invalid("Class type must be GROUP or PRIVATE.");
  }
  if (mode === "USE_CREDIT") {
    if (!bookingType) return invalid("Class type (GROUP or PRIVATE) is required to use a credit.");
    if (ratePlanId !== undefined || amount !== undefined) {
      return invalid("A credit booking has no rate or amount; use PAID_OFFLINE to record a payment.");
    }
  } else {
    if (typeof ratePlanId !== "string" || !ratePlanId) {
      return invalid("Select the class type/rate for an offline-paid booking.");
    }
    if (amount !== undefined && (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0)) {
      return invalid("Amount must be a non-negative whole number.");
    }
  }

  try {
    const result = await adminSessionService.addMemberToSession(sessionId, {
      userId,
      mode,
      bookingType,
      ratePlanId,
      amount,
    });

    return res.status(201).json({
      success: true,
      message:
        mode === "USE_CREDIT"
          ? "Member added to the session using a membership credit."
          : "Member added to the session as an offline-paid booking.",
      data: result,
    });
  } catch (error: unknown) {
    const failure = error as { status?: number; code?: string; message?: string } | null;
    return res.status(failure?.status ?? 400).json({
      success: false,
      ...(failure?.code ? { code: failure.code } : {}),
      message: failure?.message || "Failed to add member to the session.",
    });
  }
}

}

export default new AdminSessionController();