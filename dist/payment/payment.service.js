import axios from "axios";
class PaymentService {
    getHeaders() {
        return {
            Authorization: `Bearer ${process.env.PAYMISH_SECRET_KEY}`,
            "Content-Type": "application/json",
        };
    }
    // =========================================================
    // INITIALIZE PAYSTACK TRANSACTION
    // =========================================================
    async initializeTransaction(data) {
        try {
            const payload = {
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
                callback_url: data.callback_url ??
                    process.env.PAYMISH_CALLBACK_URL,
                reference: data.reference,
            };
            const response = await axios.post(`${process.env.PAYMISH_BASE_URL}/api/transaction-service/external/v1/transaction-initialize`, payload, {
                headers: this.getHeaders(),
            });
            console.log("========== PAYMISH INITIALIZE ==========");
            console.log(response.data);
            console.log("=========================================");
            return response.data;
        }
        catch (error) {
            if (axios.isAxiosError(error)) {
                console.error("========== PAYMISH INITIALIZE FAILED ==========");
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
    async verifyTransaction(reference) {
        try {
            const response = await axios.get(`${process.env.PAYMISH_BASE_URL}/api/transaction-service/external/v1/verify/${encodeURIComponent(reference)}`, {
                headers: this.getHeaders(),
            });
            console.log("========== PAYMISH VERIFY ==========");
            console.log(response.data);
            console.log("=====================================");
            return response.data;
        }
        catch (error) {
            if (axios.isAxiosError(error)) {
                console.error("========== PAYMISH VERIFY FAILED ==========");
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
    async handleWebhook(payload) {
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
//# sourceMappingURL=payment.service.js.map