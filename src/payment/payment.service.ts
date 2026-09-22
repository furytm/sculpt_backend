import axios from "axios";

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

  async handleWebhook(payload: unknown) {
    console.log("========== PAYSTACK WEBHOOK ==========");
    console.log(payload);
    console.log("======================================");

    // Webhook verification can be added separately.
    // For now, transaction verification in the callback
    // remains the source of truth.

    return {
      received: true,
    };
  }
}

export default new PaymentService();