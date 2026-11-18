/**
 * The one shape every Paymish failure takes inside the backend.
 *
 * Callers and logs get the safe diagnostic fields (operation, HTTP
 * status, the provider's own code and message, sanitized). The raw
 * provider response is never kept, and `message` is a generic text that
 * is safe to show to a customer.
 */
import axios from "axios";
import { sanitizeText } from "../observability/sanitize.js";
export const PAYMENT_PROVIDER_PUBLIC_MESSAGE = "We couldn't reach our payment provider. Please try again in a moment.";
export class PaymentProviderError extends Error {
    operation;
    reference;
    providerHttpStatus;
    providerCode;
    providerMessage;
    code;
    constructor(operation, reference, 
    /** HTTP status Paymish answered with; undefined when it couldn't be reached. */
    providerHttpStatus, 
    /** Paymish's own status/code field, when it sent one. */
    providerCode, 
    /** Paymish's message, sanitized and truncated. For logs only. */
    providerMessage) {
        super(PAYMENT_PROVIDER_PUBLIC_MESSAGE);
        this.operation = operation;
        this.reference = reference;
        this.providerHttpStatus = providerHttpStatus;
        this.providerCode = providerCode;
        this.providerMessage = providerMessage;
        this.name = "PaymentProviderError";
        this.code =
            providerHttpStatus === undefined ? "PAYMENT_PROVIDER_UNAVAILABLE" : "PAYMENT_PROVIDER_ERROR";
    }
    /** Safe fields for logging. */
    toLogFields() {
        return {
            operation: this.operation,
            providerHttpStatus: this.providerHttpStatus ?? null,
            providerCode: this.providerCode ?? null,
            providerMessage: this.providerMessage ?? null,
        };
    }
}
function pickString(source, keys) {
    if (!source || typeof source !== "object")
        return undefined;
    for (const key of keys) {
        const value = source[key];
        if (typeof value === "string" && value.trim())
            return value;
        if (typeof value === "number")
            return String(value);
    }
    return undefined;
}
/**
 * True only for a genuine Paymish failure: Paymish answered with an
 * error, or the request was sent and got no answer (timeout, network).
 *
 * Everything else stays distinguishable and is NOT a provider failure:
 * programming errors, malformed application data, and axios
 * configuration errors where no request was ever sent (for example a
 * missing PAYMISH_BASE_URL).
 */
export function isPaymentProviderFailure(error) {
    if (error instanceof PaymentProviderError)
        return true;
    if (!axios.isAxiosError(error))
        return false;
    return Boolean(error.response) || Boolean(error.request);
}
/** Turns a genuine axios/Paymish failure into a PaymentProviderError. */
export function toPaymentProviderError(error, operation, reference) {
    if (error instanceof PaymentProviderError)
        return error;
    if (axios.isAxiosError(error)) {
        const data = error.response?.data;
        const message = pickString(data, ["message", "error", "detail", "description"]) ??
            (typeof data === "string" ? data : undefined) ??
            error.code ??
            error.message;
        return new PaymentProviderError(operation, reference, error.response?.status, pickString(data, ["code", "status", "errorCode"]), message ? sanitizeText(message) : undefined);
    }
    return new PaymentProviderError(operation, reference, undefined, undefined, sanitizeText(error instanceof Error ? error.message : error));
}
//# sourceMappingURL=payment-provider.error.js.map