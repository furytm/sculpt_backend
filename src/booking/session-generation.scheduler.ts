/**
 * Re-run class session generation every 24 hours, so the rolling 30-day
 * supply of sessions keeps moving forward while the server stays up
 * (generation otherwise only runs at startup).
 *
 * - Runs the generator it is given; it does not change what is generated.
 * - Never overlaps: if a run is still in progress, the next one is skipped.
 * - Never throws: a failed run is logged and the next one runs as normal.
 * - stop() clears the timer, for a graceful shutdown. The timer is also
 *   unref'd, so it never keeps the process alive on its own.
 */
export const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function scheduleDailySessionGeneration(
  generate: () => Promise<unknown>,
  options: {
    intervalMs?: number;
    logger?: Pick<Console, "warn" | "error">;
  } = {}
) {
  const intervalMs = options.intervalMs ?? DAILY_INTERVAL_MS;
  const logger = options.logger ?? console;

  let running = false;

  const run = async () => {
    if (running) {
      logger.warn(
        "⏭️ Skipping scheduled class session generation: the previous run is still in progress."
      );
      return;
    }

    running = true;

    try {
      await generate();
    } catch (error) {
      logger.error("❌ Scheduled class session generation failed:", error);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void run();
  }, intervalMs);

  timer.unref();

  return {
    /** Run once now, with the same overlap and error handling. */
    run,

    /** Stop the recurring runs. */
    stop: () => clearInterval(timer),
  };
}
