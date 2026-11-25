/**
 * The vocabulary of the activity log. Stored as strings (no Prisma
 * enums), so adding an action needs no migration; this file keeps them
 * consistent.
 */

export type ActorType = "MEMBER" | "GUEST" | "ADMIN" | "SYSTEM" | "WEBHOOK";

export type ActivityAction =
  // Phase 1: membership payments.
  | "membership.purchase"
  | "membership.upgrade"
  | "membership.renewal"
  | "membership.purchase_completion"
  | "payment.initialize"
  | "payment.verify"
  | "payment.callback"
  | "payment.webhook"
  // Phase 2: bookings, credits, activation.
  | "booking"
  | "booking.payment"
  | "booking.confirmation"
  | "booking.cancellation"
  | "credit.deduction"
  | "credit.restoration"
  | "credit.admin_assignment"
  | "credit.admin_removal"
  | "membership.activation"
  // Phase 2: admin actions (actor = the admin, subject = the member).
  | "admin.offline_payment.confirm"
  | "admin.offline_payment.reject"
  | "admin.booking.delete"
  | "admin.member.create_offline"
  | "admin.member.delete"
  | "admin.member.resend_activation"
  | "admin.membership.assign"
  | "admin.membership_purchase.confirm"
  | "admin.membership_purchase.reject"
  | "admin.membership_purchase.retry_first_booking"
  | "admin.membership_purchase.reconcile_apply"
  | "admin.membership_purchase.reconcile_refund"
  | "admin.session.cancel"
  | "admin.session.reopen"
  | "admin.session.add_offline_attendee"
  | "admin.session.add_member"
  | "admin.membership.remove_credits"
  | "admin.membership.remove_pool_credits"
  // Health & Safety (never the notes).
  | "health_safety.update"
  // Errors no route handled.
  | "system.unhandled_error";

export type ActivityStage =
  | "INITIATED"
  | "VALIDATION_FAILED"
  /** A payment URL was returned. NOT completion: that needs a verified payment. */
  | "PAYMENT_INITIALIZED"
  | "PROVIDER_FAILED"
  | "RECEIVED"
  | "VERIFIED"
  | "VERIFICATION_FAILED"
  | "SUCCEEDED"
  | "FAILED"
  | "WARNING";

export type ActivityStatus = "SUCCESS" | "FAILURE" | "INFO" | "WARNING";

export type EntityType =
  | "MEMBERSHIP_PURCHASE"
  | "BOOKING"
  | "MEMBER_MEMBERSHIP"
  | "USER"
  | "CLASS_SESSION"
  | "HEALTH_SAFETY_FORM"
  | "HEALTH_SAFETY_REVISION";

export const ENTITY_TYPES: readonly EntityType[] = [
  "MEMBERSHIP_PURCHASE",
  "BOOKING",
  "MEMBER_MEMBERSHIP",
  "USER",
  "CLASS_SESSION",
  "HEALTH_SAFETY_FORM",
  "HEALTH_SAFETY_REVISION",
];

export const ACTOR_TYPES: readonly ActorType[] = ["MEMBER", "GUEST", "ADMIN", "SYSTEM", "WEBHOOK"];
export const ACTIVITY_STATUSES: readonly ActivityStatus[] = ["SUCCESS", "FAILURE", "INFO", "WARNING"];

export interface ActivityEvent {
  action: ActivityAction;
  stage: ActivityStage;
  status: ActivityStatus;
  /** Defaults to MEMBER when the event resolves to an account, otherwise GUEST. */
  actorType?: ActorType;
  userId?: string | null;
  actorUserId?: string | null;
  subjectEmail?: string | null;
  description?: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  httpStatus?: number | null;
  entityType?: EntityType | null;
  entityId?: string | null;
  paymentReference?: string | null;
  /** Defaults to the request's correlation ID (or its request ID). */
  correlationId?: string | null;
  /** Same key twice: only the first event is stored. */
  dedupeKey?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * The only metadata keys that are ever stored. Anything else is dropped
 * (and counted as droppedFields). Keep these free of personal data.
 */
export const ALLOWED_METADATA_KEYS: ReadonlySet<string> = new Set([
  "membershipId",
  "targetMembershipId",
  "purchaseType",
  "purchaseId",
  "amount",
  "carriedCredits",
  "newCreditsTotal",
  "reusedPendingPurchase",
  "hasFirstSession",
  "signedIn",
  "operation",
  "providerHttpStatus",
  "providerCode",
  "providerMessage",
  "transactionStatus",
  "verificationStatus",
  "webhookEvent",
  "processed",
  "reconciliationRequired",
  "source",
  "outcome",
  "notification",
  "missingFields",
  "errorKind",
  "prismaCode",
  // Phase 2: bookings and credits (identifiers and numbers only).
  "bookingType",
  "bookingStatus",
  "paymentMethod",
  "memberMembershipId",
  "bookingId",
  "classSessionId",
  "creditsDeducted",
  "creditsRestored",
  "creditsAssigned",
  "creditsTotal",
  "creditsUsed",
  "creditsRemaining",
  "unlimitedCredits",
  "cancelledBookings",
  "emailSent",
  "firstBookingCreated",
  // Phase 2: request outcome (route template, never the query string).
  "route",
  "method",
  // Health & Safety: identifiers and flags only, never notes.
  "formId",
  "revisionId",
  "declarationKind",
  "notesProvided",
  // Health & Safety propagation to upcoming bookings: counts and flags only.
  "upcomingBookingsUpdated",
  "declarationFormsCreated",
  "declarationChanged",
  // Admin credit removal and admin member bookings (numbers and identifiers only).
  "creditsRemoved",
  "previousCreditsTotal",
  "previousCreditsRemaining",
  "creditMode",
  // Pooled credit removal (numbers and identifiers only).
  "membershipType",
  "previousPoolRemaining",
  "poolRemaining",
  "recordsAffected",
]);
