/**
 * Structured console logging: one JSON line per event, with the request
 * and correlation IDs attached and every field sanitized. Never throws.
 */
import { getRequestContext } from "./request-context.js";
import { sanitizeForConsole } from "./sanitize.js";
function write(level, event, fields) {
    try {
        const context = getRequestContext();
        const line = JSON.stringify({
            level,
            time: new Date().toISOString(),
            event,
            requestId: context?.requestId,
            correlationId: context?.correlationId,
            ...sanitizeForConsole(fields ?? {}),
        });
        if (level === "error")
            console.error(line);
        else if (level === "warn")
            console.warn(line);
        else
            console.log(line);
    }
    catch {
        // Logging must never affect the operation being logged.
    }
}
export const logger = {
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, fields) => write("error", event, fields),
};
//# sourceMappingURL=logger.js.map