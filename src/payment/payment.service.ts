import axios from "axios";
import crypto from "node:crypto";

import prisma from "../config/prisma.js";
import membershipService from "../membership/membership.service.js";
import bookingService from "../booking/booking.service.js";

export interface InitializePaymentDto {
  email: string;
  amount: number;
  reference: string;
  currency?: string;
  channels?: string[];
  transaction_charge?: number;
  split_code?: string;
  subaccount?: string;
  bearer?: string;
  callback_url?: string;
}
class PaymentService {
private getHeaders() {
  return {
    Authorization: `Bearer ${process.env.PAYMISH_SECRET_KEY}`,
    "Content-Type": "application/json",
  };
}

  // =========================================================
  // INITIALIZE PAYSTACK TRANSACTION
  // =========================================================

async initializeTransaction(data: InitializePaymentDto) {
  try {
    const payload: Record<string, any> = {
      email: data.email,

      // Keep the amount exactly as your old Paymish integration used it.
      amount: data.amount,

      currency: data.currency ?? "NGN",

      channels: data.channels ?? [
        "card",
        "ussd",
        "nqr",
        "transfer",
      ],

      callback_url:
        data.callback_url ??
        process.env.PAYMISH_CALLBACK_URL,

      reference: data.reference,
    };

    const response = await axios.post(
      `${process.env.PAYMISH_BASE_URL}/api/transaction-service/external/v1/transaction-initialize`,
      payload,
      {
        headers: this.getHeaders(),
      }
    );

    console.log("========== PAYMISH INITIALIZE ==========");
    console.log(response.data);
    console.log("=========================================");

    return response.data;
  } catch (error: any) {
    if (axios.isAxiosError(error)) {
      console.error(
        "========== PAYMISH INITIALIZE FAILED =========="
      );
      console.error("STATUS:", error.response?.status);
      console.error("DATA:", error.response?.data);
      console.error("===============================================");

      throw error.response?.data ?? error.message;
    }

    throw error;
  }
}

  // =========================================================
  // VERIFY PAYSTACK TRANSACTION
  // =========================================================

 // =========================================================
// VERIFY PAYMISH TRANSACTION
// =========================================================

async verifyTransaction(reference: string) {
  try {
    const response = await axios.get(
      `${process.env.PAYMISH_BASE_URL}/api/transaction-service/external/v1/verify/${encodeURIComponent(
        reference
      )}`,
      {
        headers: this.getHeaders(),
      }
    );

    console.log("========== PAYMISH VERIFY ==========");
    console.log(response.data);
    console.log("=====================================");

    return response.data;
  } catch (error: any) {
    if (axios.isAxiosError(error)) {
      console.error(
        "========== PAYMISH VERIFY FAILED =========="
      );
      console.error("STATUS:", error.response?.status);
      console.error("DATA:", error.response?.data);
      console.error("============================================");

      throw error.response?.data ?? error.message;
    }

    throw error;
  }
}
  // =========================================================
  // WEBHOOK
  // =========================================================

async handleWebhook(
  rawBody: Buffer,
  signature: string | undefined
) {
  const webhookSecret = process.env.PAYMISH_WEBHOOK_SECRET;

  if (!webhookSecret) {
    throw new Error(
      "PAYMISH_WEBHOOK_SECRET is not configured."
    );
  }

  if (!signature) {
    throw new Error(
      "Paymish webhook signature is missing."
    );
  }

  // =====================================================
  // VERIFY PAYMISH WEBHOOK SIGNATURE
  // =====================================================

  const expectedSignature = crypto
    .createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("hex");

  const expectedBuffer =
    Buffer.from(expectedSignature, "utf8");

  const receivedBuffer =
    Buffer.from(signature, "utf8");

  if (
    expectedBuffer.length !==
    receivedBuffer.length
  ) {
    throw new Error(
      "Invalid Paymish webhook signature."
    );
  }

  if (
    !crypto.timingSafeEqual(
      expectedBuffer,
      receivedBuffer
    )
  ) {
    throw new Error(
      "Invalid Paymish webhook signature."
    );
  }

  // =====================================================
  // PARSE PAYLOAD AFTER SIGNATURE VERIFICATION
  // =====================================================

  let payload: any;

  try {
    payload = JSON.parse(
      rawBody.toString("utf8")
    );
  } catch {
    throw new Error(
      "Invalid Paymish webhook JSON payload."
    );
  }

  console.log(
    "========== PAYMISH WEBHOOK =========="
  );

  console.log(
    JSON.stringify(payload, null, 2)
  );

  console.log(
    "====================================="
  );

  // =====================================================
  // CHECK EVENT
  // =====================================================

  const event = payload?.event;

  if (event !== "transaction.successful") {
    return {
      received: true,
      processed: false,
      event,
    };
  }

  // =====================================================
  // GET TRANSACTION DATA
  // =====================================================

  const transaction = payload?.data;

  if (!transaction) {
    throw new Error(
      "Paymish webhook transaction data is missing."
    );
  }

  const reference = transaction.reference;

  if (
    !reference ||
    typeof reference !== "string"
  ) {
    throw new Error(
      "Paymish webhook payment reference is missing."
    );
  }

  // =====================================================
  // CHECK MEMBERSHIP PURCHASE FIRST
  // =====================================================

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

    return {
      received: true,
      processed: true,
      type: "membership",
      reference,
    };
  }

  // =====================================================
  // OTHERWISE CHECK NORMAL BOOKING
  // =====================================================

  const booking =
    await prisma.booking.findUnique({
      where: {
        paymentReference: reference,
      },
    });

  if (!booking) {
    console.warn(
      "Paymish webhook reference does not match a Sculpt LAB booking or membership purchase:",
      reference
    );

    return {
      received: true,
      processed: false,
      reference,
      message:
        "Payment reference not found.",
    };
  }

  // =====================================================
  // MARK BOOKING AS PAID
  // =====================================================

  await bookingService.markBookingPaid(
    reference
  );

  return {
    received: true,
    processed: true,
    type: "booking",
    reference,
  };
}
}

export default new PaymentService();