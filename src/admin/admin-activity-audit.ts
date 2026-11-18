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
