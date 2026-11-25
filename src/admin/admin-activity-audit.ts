/**
 * Activity auditing for the EXISTING admin actions (no new operations).
 * Each is mounted after authenticate + requireAdmin in admin.route.ts.
 * The actor is the authenticated admin; the subject is the affected
 * member (from the route, the response, or the record itself).
 */
import { auditAction } from "../activity-log/activity-audit.middleware.js";
import { record, recordCancellationSucceeded, recordCreditChange } from "../activity-log/activity-events.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response bodies are untyped JSON
type Json = any;

const bodyEmail = (req: { body?: Json }) =>
  typeof req.body?.email === "string" ? req.body.email : null;

export const adminAudit = {
  resendActivation: auditAction({
    action: "admin.member.resend_activation",
    description: "Admin resent a registration/activation email",
    subjectEmailFromRequest: bodyEmail,
  }),

  addOfflineAttendee: auditAction({
    action: "admin.session.add_offline_attendee",
    description: "Admin added an offline attendee to a class session",
    entityType: "BOOKING",
    entityIdFromResponse: (payload: Json) => payload?.id ?? null,
    subjectEmailFromRequest: bodyEmail,
    metadataFromResponse: (payload: Json) => ({
      classSessionId: payload?.sessionId ?? null,
      bookingStatus: payload?.bookingStatus ?? null,
      bookingType: payload?.bookingType ?? null,
      paymentMethod: payload?.paymentMethod ?? null,
      amount: Number.isInteger(payload?.amount) ? payload.amount : null,
    }),
  }),

  cancelBooking: auditAction({
    action: "booking.cancellation",
    description: "Admin cancelled a booking",
    entityType: "BOOKING",
    entityParam: "bookingId",
    snapshotBooking: true,
    recordInitiated: true,
    onSuccess: ({ payload, actor, entityId, bookingBefore }) => {
      if (!entityId) return;
      recordCancellationSucceeded({
        actor,
        userId: bookingBefore?.userId ?? null,
        bookingId: entityId,
        paymentReference: bookingBefore?.paymentReference ?? null,
        memberMembershipId: bookingBefore?.memberMembershipId ?? null,
        creditRestored: payload?.creditRestored === true,
      });
    },
  }),

  deleteBooking: auditAction({
    action: "admin.booking.delete",
    description: "Admin permanently deleted a booking",
    entityType: "BOOKING",
    entityParam: "bookingId",
    snapshotBooking: true,
    onSuccess: ({ payload, actor, entityId, bookingBefore }) => {
      if (!entityId) return;
      record({
        action: "admin.booking.delete",
        stage: "SUCCEEDED",
        status: "SUCCESS",
        actorType: actor.actorType,
        actorUserId: actor.actorUserId,
        userId: bookingBefore?.userId ?? null,
        subjectEmail: bookingBefore?.userId ? null : bookingBefore?.email ?? null,
        entityType: "BOOKING",
        entityId,
        paymentReference: bookingBefore?.paymentReference ?? null,
        description: "Admin permanently deleted a booking",
        metadata: { creditsRestored: payload?.creditRestored === true ? 1 : 0 },
      });
      if (payload?.creditRestored === true) {
        recordCreditChange({
          action: "credit.restoration",
          memberMembershipId: bookingBefore?.memberMembershipId,
          bookingId: entityId,
          actor,
          credits: 1,
          dedupeKey: `credit.restoration:booking:${entityId}`,
        });
      }
    },
  }),

  confirmOfflinePayment: auditAction({
    action: "admin.offline_payment.confirm",
    description: "Admin confirmed an offline payment",
    entityType: "BOOKING",
    entityParam: "bookingId",
  }),

  rejectOfflinePayment: auditAction({
    action: "admin.offline_payment.reject",
    description: "Admin rejected an offline payment",
    entityType: "BOOKING",
    entityParam: "bookingId",
  }),

  cancelSession: auditAction({
    action: "admin.session.cancel",
    description: "Admin cancelled a class session",
    entityType: "CLASS_SESSION",
    entityParam: "sessionId",
    metadataFromResponse: (payload: Json) => ({
      cancelledBookings: Number.isInteger(payload?.cancelledBookings) ? payload.cancelledBookings : null,
      creditsRestored: Number.isInteger(payload?.creditsRestored) ? payload.creditsRestored : null,
    }),
  }),

  reopenSession: auditAction({
    action: "admin.session.reopen",
    description: "Admin reopened a class session",
    entityType: "CLASS_SESSION",
    entityParam: "sessionId",
  }),

  createOfflineMember: auditAction({
    action: "admin.member.create_offline",
    description: "Admin onboarded an offline member",
    entityType: "BOOKING",
    entityIdFromResponse: (payload: Json) => payload?.booking?.id ?? null,
    subjectEmailFromRequest: bodyEmail,
    metadataFromResponse: (payload: Json) => ({
      membershipId: payload?.membership?.id ?? null,
      emailSent: payload?.activation?.emailSent === true,
    }),
  }),

  deleteMember: auditAction({
    action: "admin.member.delete",
    description: "Admin deleted a member",
    entityType: "USER",
    entityParam: "memberId",
    // The account is gone afterwards: the event keeps only its ID.
    subjectDeleted: true,
  }),

  addMembershipToMember: auditAction({
    action: "admin.membership.assign",
    description: "Admin assigned a membership to a member",
    entityType: "USER",
    subjectUserParam: "memberId",
    onSuccess: ({ payload, actor, req }) => {
      const memberId = typeof req.params?.memberId === "string" ? req.params.memberId : null;
      const memberMembershipId = typeof payload?.id === "string" ? payload.id : null;
      const creditsTotal = Number.isInteger(payload?.creditsTotal) ? payload.creditsTotal : null;
      const creditsUsed = Number.isInteger(payload?.creditsUsed) ? payload.creditsUsed : null;

      record({
        action: "admin.membership.assign",
        stage: "SUCCEEDED",
        status: "SUCCESS",
        actorType: actor.actorType,
        actorUserId: actor.actorUserId,
        userId: memberId,
        entityType: "MEMBER_MEMBERSHIP",
        entityId: memberMembershipId,
        description: "Admin assigned a membership to a member",
        metadata: { membershipId: payload?.membershipId ?? null, memberMembershipId },
      });

      // Credits granted with the membership (unlimited plans have none).
      if (creditsTotal !== null) {
        record({
          action: "credit.admin_assignment",
          stage: "SUCCEEDED",
          status: "SUCCESS",
          actorType: actor.actorType,
          actorUserId: actor.actorUserId,
          userId: memberId,
          entityType: "MEMBER_MEMBERSHIP",
          entityId: memberMembershipId,
          description: "Admin assigned class credits with a membership.",
          metadata: {
            memberMembershipId,
            creditsAssigned: creditsTotal - (creditsUsed ?? 0),
            creditsTotal,
            creditsUsed,
            creditsRemaining: Math.max(creditsTotal - (creditsUsed ?? 0), 0),
          },
        });
      }
    },
  }),

  removeCredits: auditAction({
    action: "admin.membership.remove_credits",
    description: "Admin removed credits from a membership",
    entityType: "MEMBER_MEMBERSHIP",
    entityParam: "memberMembershipId",
    onSuccess: ({ payload, actor }) => {
      const memberMembershipId = typeof payload?.memberMembershipId === "string" ? payload.memberMembershipId : null;
      const userId = typeof payload?.userId === "string" ? payload.userId : null;
      const previous = payload?.previous ?? {};
      const updated = payload?.updated ?? {};
      const metadata = {
        memberMembershipId,
        membershipId: payload?.membershipId ?? null,
        creditsRemoved: Number.isInteger(payload?.creditsRemoved) ? payload.creditsRemoved : null,
        previousCreditsTotal: Number.isInteger(previous.creditsTotal) ? previous.creditsTotal : null,
        previousCreditsRemaining: Number.isInteger(previous.remainingCredits) ? previous.remainingCredits : null,
        creditsTotal: Number.isInteger(updated.creditsTotal) ? updated.creditsTotal : null,
        creditsUsed: Number.isInteger(updated.creditsUsed) ? updated.creditsUsed : null,
        creditsRemaining: Number.isInteger(updated.remainingCredits) ? updated.remainingCredits : null,
      };

      record({
        action: "admin.membership.remove_credits",
        stage: "SUCCEEDED",
        status: "SUCCESS",
        actorType: actor.actorType,
        actorUserId: actor.actorUserId,
        userId,
        entityType: "MEMBER_MEMBERSHIP",
        entityId: memberMembershipId,
        description: "Admin removed credits from a membership",
        metadata,
      });

      record({
        action: "credit.admin_removal",
        stage: "SUCCEEDED",
        status: "SUCCESS",
        actorType: actor.actorType,
        actorUserId: actor.actorUserId,
        userId,
        entityType: "MEMBER_MEMBERSHIP",
        entityId: memberMembershipId,
        description: "Admin removed unused class credits.",
        metadata,
      });
    },
  }),

  /**
   * Pooled removal: one summary event for the member and pool, plus one
   * credit.admin_removal event per membership row that lost credits (the
   * metadata store holds flat values only, so each row is its own event).
   * All share the request's correlation ID.
   */
  removePoolCredits: auditAction({
    action: "admin.membership.remove_pool_credits",
    description: "Admin removed credits from a member's credit pool",
    entityType: "USER",
    entityParam: "memberId",
    subjectUserParam: "memberId",
    onSuccess: ({ payload, actor }) => {
      const userId = typeof payload?.userId === "string" ? payload.userId : null;
      const memberId = typeof payload?.memberId === "string" ? payload.memberId : null;
      const membershipType = typeof payload?.membershipType === "string" ? payload.membershipType : null;
      const int = (value: unknown) => (Number.isInteger(value) ? (value as number) : null);
      const previousPoolRemaining = int(payload?.previous?.poolRemaining);
      const poolRemaining = int(payload?.updated?.poolRemaining);
      const allocations: Json[] = Array.isArray(payload?.allocations) ? payload.allocations : [];

      record({
        action: "admin.membership.remove_pool_credits",
        stage: "SUCCEEDED",
        status: "SUCCESS",
        actorType: actor.actorType,
        actorUserId: actor.actorUserId,
        userId,
        // An offline member has no account: the pool is its own membership row.
        entityType: userId ? "USER" : "MEMBER_MEMBERSHIP",
        entityId: userId ?? memberId,
        description: "Admin removed credits from a member's credit pool",
        metadata: {
          membershipType,
          creditsRemoved: int(payload?.creditsRemoved),
          previousPoolRemaining,
          poolRemaining,
          recordsAffected: allocations.length,
        },
      });

      for (const item of allocations) {
        const memberMembershipId = typeof item?.memberMembershipId === "string" ? item.memberMembershipId : null;
        record({
          action: "credit.admin_removal",
          stage: "SUCCEEDED",
          status: "SUCCESS",
          actorType: actor.actorType,
          actorUserId: actor.actorUserId,
          userId,
          entityType: "MEMBER_MEMBERSHIP",
          entityId: memberMembershipId,
          description: "Admin removed unused class credits (from the member's credit pool).",
          metadata: {
            source: "credit_pool",
            membershipType,
            memberMembershipId,
            membershipId: item?.membershipId ?? null,
            creditsRemoved: int(item?.creditsRemoved),
            previousCreditsTotal: int(item?.previous?.creditsTotal),
            previousCreditsRemaining: int(item?.previous?.remainingCredits),
            creditsTotal: int(item?.updated?.creditsTotal),
            creditsUsed: int(item?.updated?.creditsUsed),
            creditsRemaining: int(item?.updated?.remainingCredits),
            previousPoolRemaining,
            poolRemaining,
          },
        });
      }
    },
  }),

  addMemberToSession: auditAction({
    action: "admin.session.add_member",
    description: "Admin added a registered member to a class session",
    entityType: "BOOKING",
    entityIdFromResponse: (payload: Json) => payload?.booking?.id ?? null,
    subjectFromResponse: (payload: Json) => payload?.booking?.userId ?? null,
    onSuccess: ({ payload, actor }) => {
      const booking = payload?.booking ?? {};
      const bookingId = typeof booking.id === "string" ? booking.id : null;
      const userId = typeof booking.userId === "string" ? booking.userId : null;

      record({
        action: "admin.session.add_member",
        stage: "SUCCEEDED",
        status: "SUCCESS",
        actorType: actor.actorType,
        actorUserId: actor.actorUserId,
        userId,
        entityType: "BOOKING",
        entityId: bookingId,
        paymentReference: typeof booking.paymentReference === "string" ? booking.paymentReference : null,
        description: "Admin added a registered member to a class session",
        metadata: {
          bookingId,
          classSessionId: booking.sessionId ?? null,
          creditMode: payload?.mode ?? null,
          bookingType: payload?.bookingType ?? null,
          paymentMethod: booking.paymentMethod ?? null,
          amount: Number.isInteger(booking.amount) ? booking.amount : null,
          memberMembershipId: booking.memberMembershipId ?? null,
        },
      });

      // Same credit event the member booking records.
      if (payload?.mode === "USE_CREDIT" && booking.memberMembershipId) {
        record({
          action: "credit.deduction",
          stage: "SUCCEEDED",
          status: "SUCCESS",
          actorType: actor.actorType,
          actorUserId: actor.actorUserId,
          userId,
          entityType: "MEMBER_MEMBERSHIP",
          entityId: booking.memberMembershipId,
          description: "Admin booking used a membership credit.",
          dedupeKey: bookingId ? `credit.deduction:booking:${bookingId}` : null,
          metadata: {
            bookingId,
            memberMembershipId: booking.memberMembershipId,
            creditsDeducted: payload?.creditsDeducted ?? null,
            creditsRemaining: Number.isInteger(payload?.creditsRemaining) ? payload.creditsRemaining : null,
          },
        });
      }
    },
  }),

  confirmMembershipPurchase: auditAction({
    action: "admin.membership_purchase.confirm",
    description: "Admin confirmed an offline membership purchase",
    entityType: "MEMBERSHIP_PURCHASE",
    entityParam: "purchaseId",
  }),

  retryFirstBooking: auditAction({
    action: "admin.membership_purchase.retry_first_booking",
    description: "Admin retried the first class booking of a membership purchase",
    entityType: "MEMBERSHIP_PURCHASE",
    entityParam: "purchaseId",
  }),

  rejectMembershipPurchase: auditAction({
    action: "admin.membership_purchase.reject",
    description: "Admin rejected an offline membership purchase",
    entityType: "MEMBERSHIP_PURCHASE",
    entityParam: "purchaseId",
  }),

  applyPaidFailedPurchase: auditAction({
    action: "admin.membership_purchase.reconcile_apply",
    description: "Admin applied a paid, previously cancelled purchase",
    entityType: "MEMBERSHIP_PURCHASE",
    entityParam: "purchaseId",
  }),

  markPurchaseRefunded: auditAction({
    action: "admin.membership_purchase.reconcile_refund",
    description: "Admin marked a paid, cancelled purchase as refunded",
    entityType: "MEMBERSHIP_PURCHASE",
    entityParam: "purchaseId",
  }),
};
