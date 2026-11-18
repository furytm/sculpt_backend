/**
 * Route-level activity auditing for admin (and activation) actions.
 *
 * Mounted AFTER authenticate/requireAdmin, so the actor comes from the
 * verified token only (never the request body). It records the outcome
 * when the response has finished:
 *
 * - success (status < 400): SUCCEEDED, or a custom success recorder;
 * - failure: FAILED with the HTTP status and a safe message.
 *
 * It only observes: it never changes the request or the response, and
 * reads the response body (when JSON) only to pick safe identifiers and
 * counts. Nothing here can throw into the request.
 */
import { NextFunction, Request, Response } from "express";
import prisma from "../config/prisma.js";
import { getRequestContext, runInRequestContext } from "../observability/request-context.js";
import { sanitizeText } from "../observability/sanitize.js";
import { Actor, actorFromRequest, bestEffort, record } from "./activity-events.js";
import { unmatchedDedupeKey } from "./activity-log.service.js";
import { ActivityAction, EntityType } from "./activity-log.types.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response bodies are untyped JSON
type Json = any;

export interface BookingSnapshot {
  userId: string | null;
  email: string | null;
  paymentReference: string | null;
  memberMembershipId: string | null;
}

export interface AuditContext {
  req: Request;
  /** The JSON response body, unwrapped from `data` when present. */
  payload: Json;
  actor: Actor;
  entityId: string | null;
  /** Booking as it was before the request (only with snapshotBooking). */
  bookingBefore: BookingSnapshot | null;
}

export interface AuditSpec {
  action: ActivityAction;
  description: string;
  entityType?: EntityType;
  /** Route parameter holding the entity ID. */
  entityParam?: string;
  /** Entity ID from the response (for created records). */
  entityIdFromResponse?: (payload: Json) => string | null | undefined;
  /** The affected member is the route parameter (e.g. :memberId). */
  subjectUserParam?: string;
  /** The affected account is being deleted: never link the event to it. */
  subjectDeleted?: boolean;
  /** The affected member, from the response. */
  subjectFromResponse?: (payload: Json) => string | null | undefined;
  /** A guest's email from the request (only stored when there is no account). */
  subjectEmailFromRequest?: (req: Request) => string | null | undefined;
  /** Read the booking before the handler runs (e.g. it will be deleted). */
  snapshotBooking?: boolean;
  /** Record an INITIATED event when the request arrives. */
  recordInitiated?: boolean;
  /** Safe numeric/identifier metadata from the response. */
  metadataFromResponse?: (payload: Json) => Record<string, unknown>;
  /** Replaces the default success event (e.g. to add credit events). */
  onSuccess?: (context: AuditContext) => void;
  /** Public route: cap anonymous failures at one per minute. */
  capAnonymousFailures?: boolean;
}

const INTERNAL_TEXT = /prisma|invocation|\bat .+:\d+:\d+|[A-Za-z]:\\|\/node_modules\//i;

/** The response message, safe to store: never server details. */
function safeFailureMessage(message: unknown, status: number): string {
  if (status >= 500) return `Server error (HTTP ${status}).`;
  if (typeof message !== "string" || !message.trim()) return `Request failed (HTTP ${status}).`;
  if (INTERNAL_TEXT.test(message)) return `Request failed (internal error, HTTP ${status}).`;
  return sanitizeText(message, 300);
}

function param(req: Request, name: string | undefined): string | null {
  if (!name) return null;
  const value = req.params?.[name];
  const text = Array.isArray(value) ? value[0] : value;
  return typeof text === "string" && text ? text : null;
}

export function auditAction(spec: AuditSpec) {
  return function activityAudit(req: Request, res: Response, next: NextFunction) {
    try {
      const context = getRequestContext();
      const actor = actorFromRequest(req);
      const entityIdParam = param(req, spec.entityParam);
      const subjectParam = param(req, spec.subjectUserParam);

      const bookingBefore: Promise<BookingSnapshot | null> =
        spec.snapshotBooking && entityIdParam
          ? prisma.booking
              .findUnique({
                where: { id: entityIdParam },
                select: { userId: true, email: true, paymentReference: true, memberMembershipId: true },
              })
              .catch(() => null)
          : Promise.resolve(null);

      if (spec.recordInitiated) {
        record({
          action: spec.action,
          stage: "INITIATED",
          status: "INFO",
          actorType: actor.actorType,
          actorUserId: actor.actorUserId,
          userId: actor.memberUserId ?? (spec.subjectDeleted ? null : subjectParam),
          entityType: spec.entityType ?? null,
          entityId: entityIdParam,
          description: `${spec.description} (requested)`,
        });
      }

      // Observe the JSON body without changing it.
      let body: Json;
      const originalJson = res.json.bind(res);
      res.json = ((value: Json) => {
        body = value;
        return originalJson(value);
      }) as typeof res.json;

      res.once("finish", () => {
        void bookingBefore.then((snapshot) =>
          runInRequestContext(context, () =>
            bestEffort(() => {
              const status = res.statusCode;
              const payload = body && typeof body === "object" && "data" in body ? body.data : body;
              const entityId =
                entityIdParam ?? spec.entityIdFromResponse?.(payload) ?? null;

              const subjectUserId = spec.subjectDeleted
                ? null
                : actor.memberUserId ??
                  subjectParam ??
                  spec.subjectFromResponse?.(payload) ??
                  snapshot?.userId ??
                  null;

              const subjectEmail = subjectUserId
                ? null
                : spec.subjectEmailFromRequest?.(req) ?? snapshot?.email ?? null;

              const route = `${req.baseUrl ?? ""}${req.route?.path ?? ""}`;

              if (status < 400) {
                if (spec.onSuccess) {
                  spec.onSuccess({ req, payload, actor, entityId, bookingBefore: snapshot });
                  return;
                }

                record({
                  action: spec.action,
                  stage: "SUCCEEDED",
                  status: "SUCCESS",
                  actorType: actor.actorType,
                  actorUserId: actor.actorUserId,
                  userId: subjectUserId,
                  subjectEmail,
                  entityType: spec.entityType ?? null,
                  entityId,
                  paymentReference: snapshot?.paymentReference ?? null,
                  httpStatus: status,
                  description: spec.description,
                  metadata: { route, method: req.method, ...(spec.metadataFromResponse?.(payload) ?? {}) },
                });
                return;
              }

              const anonymous = !subjectUserId && !entityId && actor.actorType === "GUEST";

              record({
                action: spec.action,
                stage: "FAILED",
                status: "FAILURE",
                actorType: actor.actorType,
                actorUserId: actor.actorUserId,
                userId: subjectUserId,
                subjectEmail,
                entityType: spec.entityType ?? null,
                entityId,
                paymentReference: snapshot?.paymentReference ?? null,
                httpStatus: status,
                errorCode: typeof body?.code === "string" ? body.code : `HTTP_${status}`,
                errorMessage: safeFailureMessage(body?.message, status),
                description: `${spec.description} (failed)`,
                dedupeKey:
                  spec.capAnonymousFailures && anonymous ? unmatchedDedupeKey(spec.action, "FAILED") : null,
                metadata: { route, method: req.method },
              });
            })
          )
        );
      });
    } catch {
      // Auditing must never affect the request.
    }

    next();
  };
}
