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
      console.error("Paystack Initialize Error:", error);

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
      console.error("Paystack Verify Error:", error);

      return res.status(500).json({
        success: false,
        message: "Unable to verify payment.",
        error,
      });
    }
  }

  // =========================================================
  // PAYSTACK CALLBACK
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
      // VERIFY THE PAYMENT WITH PAYSTACK
      // -------------------------------------------------------

      const payment =
        await paymentService.verifyTransaction(
          reference
        );

      const transaction = payment?.data;

      if (!transaction) {
        throw new Error(
          "Invalid Paystack verification response."
        );
      }

      // -------------------------------------------------------
      // VERIFY PAYMENT STATUS
      // -------------------------------------------------------

      if (transaction.status !== "success") {
        return res.redirect(
          `${process.env.FRONTEND_URL}/confirmation?payment=failed&reference=${encodeURIComponent(
            reference
          )}`
        );
      }

      // -------------------------------------------------------
      // VERIFY AMOUNT
      // -------------------------------------------------------

      const booking =
        await bookingService.getBookingByReference(
          reference
        );

      const expectedAmount =
        Math.round(booking.amount * 100);

      if (
        Number(transaction.amount) !==
        expectedAmount
      ) {
        console.error(
          "Paystack amount mismatch:",
          {
            expected: expectedAmount,
            received: transaction.amount,
            reference,
          }
        );

        return res.redirect(
          `${process.env.FRONTEND_URL}/confirmation?payment=failed&reference=${encodeURIComponent(
            reference
          )}`
        );
      }

      // -------------------------------------------------------
      // MARK BOOKING AS PAID
      // -------------------------------------------------------

      await bookingService.markBookingPaid(
        reference
      );

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
        "Paystack Callback Error:",
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
        "Paystack Webhook Error:",
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