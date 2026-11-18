/**
 * Graceful shutdown, in this order:
 *
 * 1. stop scheduled jobs;
 * 2. stop accepting connections and let active requests finish
 *    (`server.close`, exactly as before);
 * 3. flush pending activity-log writes, for at most `flushTimeoutMs`,
 *    so logging can never hang shutdown;
 * 4. disconnect Prisma, then exit.
 *
 * A second signal while shutting down is ignored.
 */
import { logger } from "../observability/logger.js";
export const ACTIVITY_LOG_FLUSH_TIMEOUT_MS = 5_000;
export function createGracefulShutdown(deps) {
    let shuttingDown = false;
    return async function shutdown() {
        if (shuttingDown)
            return;
        shuttingDown = true;
        console.log("Shutting down server...");
        deps.stopJobs();
        // Stops new connections; resolves once active requests have finished.
        await new Promise((resolve) => {
            deps.server.close(() => resolve());
        });
        try {
            const flushed = await deps.flushActivityLog(deps.flushTimeoutMs ?? ACTIVITY_LOG_FLUSH_TIMEOUT_MS);
            if (!flushed) {
                logger.warn("shutdown.activity_log_flush_timeout", {
                    timeoutMs: deps.flushTimeoutMs ?? ACTIVITY_LOG_FLUSH_TIMEOUT_MS,
                });
            }
        }
        catch {
            // Logging must never block shutdown.
        }
        try {
            await deps.disconnect();
        }
        finally {
            deps.exit(0);
        }
    };
}
//# sourceMappingURL=graceful-shutdown.js.map