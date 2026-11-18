/**
 * Per-request context, available to every service through
 * AsyncLocalStorage without passing it as an argument.
 *
 * - requestId: generated here for every request. Never taken from the
 *   client, so it can't be forged or used to inject log lines.
 * - correlationId: one multi-step operation (for example a membership
 *   payment: initialize, callback, webhook, completion). Set only by
 *   backend code, normally to the payment reference.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { NextFunction, Request, Response } from "express";

export interface RequestContext {
  requestId: string;
  correlationId?: string;
  method?: string;
  path?: string;
  /** Called once when the response has finished (see activity log). */
  onFinish: Array<() => void>;
  /** True once the response has finished; later work runs immediately. */
  finished?: boolean;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const REQUEST_ID_HEADER = "X-Request-Id";

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/** Ties the rest of this request's events to one operation. */
export function setCorrelationId(correlationId: string | null | undefined) {
  const context = storage.getStore();
  if (context && correlationId) context.correlationId = correlationId;
}

/**
 * Sets the correlation ID only if this request has none yet, so a
 * payment already being tracked in this request is never overwritten.
 */
export function setCorrelationIdIfUnset(correlationId: string | null | undefined) {
  const context = storage.getStore();
  if (context && correlationId && !context.correlationId) context.correlationId = correlationId;
}

/**
 * Runs `fn` inside an existing request context, e.g. from an event
 * listener that Node may call outside the request's async context.
 */
export function runInRequestContext<T>(context: RequestContext | undefined, fn: () => T): T {
  return context ? storage.run(context, fn) : fn();
}

/** Runs work (a scheduled job, a test) inside a fresh context. */
export function runWithRequestContext<T>(
  fn: () => T,
  context: Partial<Omit<RequestContext, "onFinish">> = {}
): T {
  return storage.run(
    { requestId: context.requestId ?? randomUUID(), ...context, onFinish: [] },
    fn
  );
}

/** First middleware: a request ID for every request, echoed in a header. */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction) {
  const context: RequestContext = {
    requestId: randomUUID(),
    method: req.method,
    // The path only: query strings can carry references and tokens.
    path: req.originalUrl.split("?")[0],
    onFinish: [],
  };

  res.setHeader(REQUEST_ID_HEADER, context.requestId);

  const finish = () => {
    if (context.finished) return;
    context.finished = true;
    for (const callback of context.onFinish.splice(0)) {
      try {
        callback();
      } catch {
        // Observability must never affect the response.
      }
    }
  };
  res.once("finish", finish);
  res.once("close", finish);

  storage.run(context, () => next());
}
