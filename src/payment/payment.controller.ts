import prisma  from "../config/prisma.js";
import  membershipService  from "../membership/membership.service.js";
import { Request, Response } from "express";
import paymentService from "./payment.service.js";
import bookingService from "../booking/booking.service.js";

interface VerifyParams {
  reference: string;
}

class PaymentController {
  // =========================================================
  // INITIALIZE PAYMENT
  // =========================================================

  async initializePayment(req: Request, res: Response) {
    try {
      const payment =
        await paymentService.initializeTransaction(req.body);

      return res.status(200).json(payment);
    } catch (error) {
      console.error("Paymish Initialize Error:", error);

      return res.status(500).json({
        success: false,
        message: "Unable to initialize payment.",
        error,
      });
    }
  }

  // =========================================================
  // VERIFY PAYMENT
  // =========================================================
  // KEPT FOR MANUAL TESTING ONLY.
  // This is NOT used by the normal payment callback.
  // =========================================================

  async verifyPayment(
    req: Request<VerifyParams>,
    res: Response
  ) {
    try {
      const payment =
        await paymentService.verifyTransaction(
          req.params.reference
        );

      return res.status(200).json(payment);
    } catch (error) {
      console.error("Paymish Verify Error:", error);

      return res.status(500).json({
        success: false,
        message: "Unable to verify payment.",
        error,
      });
    }
  }
async callback(req: Request, res: Response) {
  const frontendUrl = process.env.FRONTEND_URL;

  const reference =
    typeof req.query.reference === "string"
      ? req.query.reference.trim()
      : "";

  try {
    console.log("========== PAYMISH CALLBACK ==========");
    console.log("REFERENCE:", reference);

    if (!frontendUrl) {
      throw new Error("FRONTEND_URL is not configured.");
    }

    if (!reference) {
      return res.redirect(
        `${frontendUrl}/confirmation?payment=failed`
      );
    }

    // ============================================
    // 1. VERIFY THE PAYMENT DIRECTLY WITH PAYMISH
    // ============================================

    const verification =
      await paymentService.verifyTransaction(reference);

    console.log("PAYMISH VERIFICATION STATUS:", verification?.status);
    console.log(
      "PAYMISH TRANSACTION STATUS:",
      verification?.data?.status
    );

    const transaction = verification?.data;

    const isVerified =
      verification?.status === "success" &&
      transaction?.status?.toLowerCase() === "completed" &&
      transaction?.reference === reference;

    if (!isVerified) {
      console.warn(
        "Payment not verified as completed:",
        reference
      );

      return res.redirect(
        `${frontendUrl}/confirmation?payment=failed&reference=${encodeURIComponent(reference)}`
      );
    }

    console.log("Payment successfully verified:", reference);

    // ============================================
    // 2. CHECK MEMBERSHIP PURCHASE
    // ============================================

    const membershipPurchase =
      await prisma.membershipPurchase.findUnique({
        where: {
          paymentReference: reference,
        },
      });

    if (membershipPurchase) {
      await membershipService.completeMembershipPurchase(
        reference
      );

      const mode =
        membershipPurchase.type === "UPGRADE"
          ? "upgrade"
          : "renew";

      return res.redirect(
        `${frontendUrl}/confirmation?status=success&mode=${mode}&reference=${encodeURIComponent(reference)}`
      );
    }

    // ============================================
    // 3. OTHERWISE, PROCESS THE BOOKING PAYMENT
    // ============================================

    await bookingService.markBookingPaid(reference);

    return res.redirect(
      `${frontendUrl}/confirmation?status=success&reference=${encodeURIComponent(reference)}`
    );
  } catch (error) {
    console.error("Paymish Callback Error:", error);

    if (!frontendUrl) {
      return res.status(500).json({
        success: false,
        message: "Payment callback configuration error.",
      });
    }

    return res.redirect(
      `${frontendUrl}/confirmation?payment=failed${
        reference
          ? `&reference=${encodeURIComponent(reference)}`
          : ""
      }`
    );
  }
}

  // =========================================================
  // WEBHOOK
  // =========================================================

async webhook(req: Request, res: Response) {
  try {
    const signature =
      req.headers["x-paymish-signature"];

    const signatureValue =
      Array.isArray(signature)
        ? signature[0]
        : signature;

    const rawBody = req.body as Buffer;

    const response =
      await paymentService.handleWebhook(
        rawBody,
        signatureValue
      );

    return res.status(200).json(response);
  } catch (error: any) {
    console.error(
      "Paymish Webhook Error:",
      error
    );

    return res.status(400).json({
      success: false,
      message:
        error?.message ||
        "Webhook processing failed.",
    });
  }
}
}

export default new PaymentController();