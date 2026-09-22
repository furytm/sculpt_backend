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

  // =========================================================
  // PAYMISH CALLBACK
  // =========================================================
  // IMPORTANT:
  // We intentionally DO NOT call verifyTransaction() here.
  // This restores the old working Sculpt LAB flow.
  // =========================================================

  async callback(req: Request, res: Response) {
    try {
      const { reference } = req.query;

      if (
        !reference ||
        typeof reference !== "string"
      ) {
        return res.status(400).json({
          success: false,
          message: "Payment reference is required.",
        });
      }

      // -------------------------------------------------------
      // MARK BOOKING AS PAID
      // -------------------------------------------------------

      await bookingService.markBookingPaid(reference);

      // -------------------------------------------------------
      // REDIRECT TO FRONTEND
      // -------------------------------------------------------

      return res.redirect(
        `${process.env.FRONTEND_URL}/confirmation?status=success&reference=${encodeURIComponent(
          reference
        )}`
      );
    } catch (error) {
      console.error(
        "Paymish Callback Error:",
        error
      );

      return res.redirect(
        `${process.env.FRONTEND_URL}/confirmation?payment=failed`
      );
    }
  }

  // =========================================================
  // WEBHOOK
  // =========================================================

  async webhook(req: Request, res: Response) {
    try {
      const response =
        await paymentService.handleWebhook(
          req.body
        );

      return res.status(200).json(response);
    } catch (error) {
      console.error(
        "Paymish Webhook Error:",
        error
      );

      return res.status(500).json({
        success: false,
        message: "Webhook processing failed.",
      });
    }
  }
}

export default new PaymentController();