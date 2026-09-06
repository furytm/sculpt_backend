import axios from "axios";
class PaymentService {
    getHeaders() {
        return {
            Authorization: `Bearer ${process.env.PAYMISH_SECRET_KEY}`,
            "Content-Type": "application/json",
        };
    }
    async initializeTransaction(data) {
        try {
            const payload = {
                email: data.email,
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
            // Optional fields
            if (data.transaction_charge !== undefined) {
                payload.transaction_charge = data.transaction_charge;
            }
            if (data.split_code) {
                payload.split_code = data.split_code;
            }
            if (data.subaccount) {
                payload.subaccount = data.subaccount;
            }
            if (data.bearer) {
                payload.bearer = data.bearer;
            }
            const response = await axios.post(`${process.env.PAYMISH_BASE_URL}/api/transaction-service/external/v1/transaction-initialize`, payload, {
                headers: this.getHeaders(),
            });
            console.log(response.data);
            return response.data;
        }
        catch (error) {
            if (axios.isAxiosError(error)) {
                throw error.response?.data ?? error.message;
            }
            throw error;
        }
    }
    async verifyTransaction(reference) {
        try {
            const response = await axios.get(`${process.env.PAYMISH_BASE_URL}/api/transaction-service/external/v1/verify/${reference}`, {
                headers: this.getHeaders(),
            });
            console.log("VERIFY RESPONSE");
            console.log(response.data);
            return response.data;
        }
        catch (error) {
            if (axios.isAxiosError(error)) {
                console.log("========== VERIFY FAILED ==========");
                console.log("STATUS:", error.response?.status);
                console.log("DATA:", error.response?.data);
                console.log("===================================");
                throw error.response?.data;
            }
            console.log(error);
            throw error;
        }
    }
    async handleWebhook(payload) {
        console.log("========== PAYMISH WEBHOOK ==========");
        console.log(payload);
        console.log("=====================================");
        // TODO:
        // 1. Verify webhook signature using PAYMISH_WEBHOOK_SECRET
        // 2. Update payment status
        // 3. Update booking status
        // 4. Send confirmation email
        return {
            received: true,
        };
    }
}
export default new PaymentService();
//# sourceMappingURL=payment.service.js.map