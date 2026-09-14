import axios from "axios";

export interface InitializePaymentDto {
  email: string;
  amount: number;
  reference: string;
  currency?: string;
  callback_url?: string;
}

class PaymentService {
  private getHeaders() {
    return {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
    };
  }

  // =========================================================
  // INITIALIZE PAYSTACK TRANSACTION
  // =========================================================

  async initializeTransaction(data: InitializePaymentDto) {
    try {
      const payload = {
        email: data.email,

        // Paystack expects amount in kobo
        amount: Math.round(data.amount * 100),

        currency: data.currency ?? "NGN",

        reference: data.reference,

        callback_url:
          data.callback_url ??
          process.env.PAYSTACK_CALLBACK_URL,
      };

      const response = await axios.post(
        "https://api.paystack.co/transaction/initialize",
        payload,
        {
          headers: this.getHeaders(),
        }
      );

      console.log("========== PAYSTACK INITIALIZE ==========");
      console.log(response.data);
      console.log("==========================================");

      return response.data;
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        console.error(
          "========== PAYSTACK INITIALIZE FAILED =========="
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

  async verifyTransaction(reference: string) {
    try {
      const response = await axios.get(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(
          reference
        )}`,
        {
          headers: this.getHeaders(),
        }
      );

      console.log("========== PAYSTACK VERIFY ==========");
      console.log(response.data);
      console.log("======================================");

      return response.data;
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        console.error(
          "========== PAYSTACK VERIFY FAILED =========="
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