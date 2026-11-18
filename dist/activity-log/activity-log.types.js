/**
 * The vocabulary of the activity log. Stored as strings (no Prisma
 * enums), so adding an action needs no migration; this file keeps them
 * consistent.
 */
export const ENTITY_TYPES = [
    "MEMBERSHIP_PURCHASE",
    "BOOKING",
    "MEMBER_MEMBERSHIP",
    "USER",
    "CLASS_SESSION",
    "HEALTH_SAFETY_FORM",
    "HEALTH_SAFETY_REVISION",
];
export const ACTOR_TYPES = ["MEMBER", "GUEST", "ADMIN", "SYSTEM", "WEBHOOK"];
export const ACTIVITY_STATUSES = ["SUCCESS", "FAILURE", "INFO", "WARNING"];
/**
 * The only metadata keys that are ever stored. Anything else is dropped
 * (and counted as droppedFields). Keep these free of personal data.
 */
export const ALLOWED_METADATA_KEYS = new Set([
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
]);
//# sourceMappingURL=activity-log.types.js.map