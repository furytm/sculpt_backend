/**
 * Small, best-effort helpers shared by the Phase 2 instrumentation.
 * Nothing here throws, awaits business work, or joins a transaction.
 */
import { Request } from "express";
import prisma from "../config/prisma.js";
import activityLog from "./activity-log.service.js";
import { ActivityAction, ActivityEvent, ActorType } from "./activity-log.types.js";
import { describeError, ErrorDescription } from "../observability/errors.js";
import { logger } from "../observability/logger.js";

/** Runs logging work; any failure is swallowed. */
export function bestEffort(work: () => void) {
  try {
    work();
  } catch {
    // Logging must never change the outcome of the business operation.
  }
}

export interface Actor {
  actorType: ActorType;
  /** The admin performing the action (never taken from the request body). */
  actorUserId: string | null;
  /** The member acting on their own account, if any. */
  memberUserId: string | null;
}

/** Who is acting, from the authenticated token only. */
export function actorFromRequest(req: Request): Actor {
  try {
    const user = req.user;
    if (user?.role === "ADMIN") {
      return { actorType: "ADMIN", actorUserId: user.userId, memberUserId: null };
    }
    if (user?.userId) {
      return { actorType: "MEMBER", actorUserId: null, memberUserId: user.userId };
    }
  } catch {
    // fall through
  }
  return { actorType: "GUEST", actorUserId: null, memberUserId: null };
}

export function record(event: ActivityEvent) {
  bestEffort(() => activityLog.record(event));
}

/**
 * Records a failure: the cleaned message in the activity log, and (for
 * unexpected errors) the sanitized stack in the server log only.
 */
export function recordFailure(
  event: Omit<ActivityEvent, "stage" | "status" | "errorCode" | "errorMessage">,
  error: unknown,
  businessStatus = 400
): ErrorDescription | undefined {
  try {
    const description = describeError(error, businessStatus);

    if (description.kind === "internal" || description.kind === "database") {
      logger.error(`${event.action}.failed`, {
        errorCode: description.code,
        errorKind: description.kind,
        errorMessage: description.logMessage,
        // Server logs only.
        stack: description.logStack,
      });
    }

    activityLog.record({
      ...event,
      stage: description.kind === "provider" ? "PROVIDER_FAILED" : "FAILED",
      status: "FAILURE",
      errorCode: description.code,
      errorMessage: description.logMessage,
      httpStatus: event.httpStatus ?? description.httpStatus,
      metadata: { ...(event.metadata ?? {}), errorKind: description.kind },
    });

    return description;
  } catch {
    return undefined;
  }
}

/**
 * A credit change that has already happened. The balance is read AFTER
 * the operation, outside it and without delaying the response; it is
 * the balance at the time of reading. Unlimited memberships use no
 * credits, so nothing is recorded for them.
 */
export function recordCreditChange(input: {
  action: Extract<ActivityAction, "credit.deduction" | "credit.restoration">;
  memberMembershipId: string | null | undefined;
  bookingId?: string | null;
  actor: Actor;
  /** Credits used (deduction) or given back (restoration). */
  credits: number;
  dedupeKey?: string;
  correlationId?: string | null;
}) {
  bestEffort(() => {
    const { memberMembershipId } = input;
    if (!memberMembershipId) return;

    void prisma.memberMembership
      .findUnique({
        where: { id: memberMembershipId },
        select: { userId: true, creditsTotal: true, creditsUsed: true },
      })
      .then((row) => {
        if (!row || row.creditsTotal === null) return;

        record({
          action: input.action,
          stage: "SUCCEEDED",
          status: "SUCCESS",
          actorType: input.actor.actorType,
          actorUserId: input.actor.actorUserId,
          userId: row.userId,
          entityType: "MEMBER_MEMBERSHIP",
          entityId: memberMembershipId,
          correlationId: input.correlationId ?? undefined,
          dedupeKey: input.dedupeKey,
          description:
            input.action === "credit.deduction"
              ? "Class credit used."
              : "Class credit restored.",
          metadata: {
            memberMembershipId,
            ...(input.bookingId ? { bookingId: input.bookingId } : {}),
            [input.action === "credit.deduction" ? "creditsDeducted" : "creditsRestored"]: input.credits,
            creditsTotal: row.creditsTotal,
            creditsUsed: row.creditsUsed,
            creditsRemaining: Math.max(row.creditsTotal - row.creditsUsed, 0),
          },
        });
      })
      .catch(() => undefined);
  });
}

/**
 * A cancellation that succeeded (member or admin), plus the credit it
 * gave back when the service reports one. Never throws.
 */
export function recordCancellationSucceeded(input: {
  actor: Actor;
  /** The booking owner, when known (resolved from the booking otherwise). */
  userId?: string | null;
  bookingId: string;
  paymentReference?: string | null;
  memberMembershipId?: string | null;
  creditRestored: boolean;
}) {
  bestEffort(() => {
    record({
      action: "booking.cancellation",
      stage: "SUCCEEDED",
      status: "SUCCESS",
      actorType: input.actor.actorType,
      actorUserId: input.actor.actorUserId,
      userId: input.userId ?? null,
      entityType: "BOOKING",
      entityId: input.bookingId,
      paymentReference: input.paymentReference ?? null,
      correlationId: input.paymentReference ?? null,
      description:
        input.actor.actorType === "ADMIN" ? "Booking cancelled by an admin." : "Booking cancelled by the member.",
      dedupeKey: `booking.cancellation:${input.bookingId}`,
      metadata: { bookingStatus: "CANCELLED", creditsRestored: input.creditRestored ? 1 : 0 },
    });

    if (input.creditRestored) {
      recordCreditChange({
        action: "credit.restoration",
        memberMembershipId: input.memberMembershipId,
        bookingId: input.bookingId,
        actor: input.actor,
        credits: 1,
        dedupeKey: `credit.restoration:booking:${input.bookingId}`,
        correlationId: input.paymentReference ?? null,
      });
    }
  });
}
