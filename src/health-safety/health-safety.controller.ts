/**
 * Member and admin Health & Safety endpoints.
 *
 * Member routes take the member from the verified token only (never a
 * body/query user ID). Unknown body fields are rejected.
 * Admin routes are mounted behind authenticate + requireAdmin.
 */
import { Request, Response } from "express";
import Joi from "joi";
import prisma from "../config/prisma.js";
import { adminNotificationService } from "../admin/admin-notification.service.js";
import { record, recordFailure } from "../activity-log/activity-events.js";
import { describeError, sendErrorResponse } from "../observability/errors.js";
import { logger } from "../observability/logger.js";
import { getRequestId } from "../observability/request-context.js";
import { healthSafetyService, HealthSafetyError, MAX_NOTES_LENGTH } from "./health-safety.service.js";

export const HEALTH_SAFETY_ADMIN_URL = "/admin/health-safety";
export const HEALTH_SAFETY_UPDATED = "HEALTH_SAFETY_UPDATED";

const ID = /^[A-Za-z0-9_-]{1,64}$/;

const updateSchema = Joi.object({
  accepted: Joi.boolean().valid(true).required().messages({
    "any.only": "You must accept the Health Declaration.",
    "any.required": "You must accept the Health Declaration.",
  }),
  notes: Joi.string().allow("", null).max(MAX_NOTES_LENGTH).messages({
    "string.max": `Notes must be at most ${MAX_NOTES_LENGTH} characters.`,
  }),
  bookingId: Joi.string().pattern(ID).messages({ "string.pattern.base": "bookingId has an invalid format." }),
}).messages({ "object.unknown": "{{#label}} is not allowed." });

const adminListSchema = Joi.object({
  page: Joi.number().integer().min(1).max(1000).default(1),
  limit: Joi.number().integer().min(1).max(100).default(25),
  search: Joi.string().trim().min(1).max(100),
  accepted: Joi.boolean(),
  userId: Joi.string().pattern(ID),
  bookingId: Joi.string().pattern(ID),
  kind: Joi.string().valid("BOOKING", "MEMBER", "ALL").default("ALL"),
  from: Joi.date().iso(),
  to: Joi.date().iso().when("from", { is: Joi.exist(), then: Joi.date().min(Joi.ref("from")) }),
})
  .custom((value, helpers) =>
    value.page * value.limit > 10_000 ? helpers.error("any.invalid") : value
  )
  .messages({
    "object.unknown": "{{#label}} is not a supported filter.",
    "any.invalid": "Page is too deep; narrow the filters instead.",
    "string.pattern.base": "{{#label}} has an invalid format.",
    "date.min": "\"to\" must not be before \"from\".",
  });

const revisionsSchema = Joi.object({
  formId: Joi.string().pattern(ID),
  userId: Joi.string().pattern(ID),
})
  .xor("formId", "userId")
  .messages({
    "object.xor": "Provide exactly one of formId or userId.",
    "object.missing": "Provide exactly one of formId or userId.",
    "object.unknown": "{{#label}} is not a supported filter.",
    "string.pattern.base": "{{#label}} has an invalid format.",
  });

const validationError = (res: Response, message: string) =>
  res.status(400).json({ success: false, code: "VALIDATION_ERROR", message, requestId: getRequestId() });

function failure(res: Response, error: unknown, event: string) {
  if (error instanceof HealthSafetyError) {
    return res.status(error.status).json({
      success: false,
      code: error.code,
      message: error.message,
      requestId: getRequestId(),
    });
  }
  const description = describeError(error, 500);
  logger.error(event, {
    errorCode: description.code,
    errorMessage: description.logMessage,
    stack: description.logStack,
  });
  // Never an internal or database message.
  return sendErrorResponse(
    res,
    description.kind === "business"
      ? { ...description, kind: "internal", code: "INTERNAL_ERROR", httpStatus: 500, publicMessage: "Something went wrong. Please try again." }
      : description,
    { success: false }
  );
}

/** Best-effort: never fails or delays the member's saved update beyond its own await. */
async function notifyAdmins(update: {
  userId: string;
  fullName: string;
  formId: string | null;
  bookingId: string | null;
  revisionId: string;
  kind: "BOOKING" | "MEMBER";
}) {
  try {
    await adminNotificationService.createForAllAdmins({
      // One per revision: separate updates are never merged, retries of
      // the same revision are.
      eventKey: `health_safety_updated:${update.revisionId}`,
      type: HEALTH_SAFETY_UPDATED,
      title: "Health & Safety declaration updated",
      // No health content: only who updated it.
      message: `${update.fullName || "A member"} updated their Health & Safety declaration.`,
      data: {
        userId: update.userId,
        healthSafetyFormId: update.formId,
        revisionId: update.revisionId,
        bookingId: update.bookingId,
        declarationKind: update.kind,
        url: HEALTH_SAFETY_ADMIN_URL,
      },
      url: HEALTH_SAFETY_ADMIN_URL,
    });
  } catch (error) {
    logger.warn("health_safety.notification_failed", {
      revisionId: update.revisionId,
      errorMessage: describeError(error).logMessage,
    });
    record({
      action: "health_safety.update",
      stage: "WARNING",
      status: "WARNING",
      actorType: "MEMBER",
      userId: update.userId,
      entityType: update.formId ? "HEALTH_SAFETY_FORM" : "HEALTH_SAFETY_REVISION",
      entityId: update.formId ?? update.revisionId,
      errorCode: "NOTIFICATION_FAILED",
      description: "Declaration saved, but the admin notification could not be created.",
      dedupeKey: `health_safety.notification_failed:${update.revisionId}`,
      metadata: { revisionId: update.revisionId },
    });
  }
}

export const healthSafetyController = {
  /** GET /api/members/me/health-safety */
  async getMine(req: Request, res: Response) {
    try {
      const data = await healthSafetyService.getForMember(req.user!.userId);
      return res.status(200).json({ success: true, data });
    } catch (error) {
      return failure(res, error, "health_safety.get_failed");
    }
  },

  /** PATCH /api/members/me/health-safety */
  async updateMine(req: Request, res: Response) {
    const userId = req.user!.userId;
    const { error, value } = updateSchema.validate(req.body ?? {}, { abortEarly: true });
    if (error) return validationError(res, error.details[0].message);

    try {
      const result = await healthSafetyService.updateForMember(userId, value);

      // After the transaction has committed.
      record({
        action: "health_safety.update",
        stage: "SUCCEEDED",
        status: "SUCCESS",
        actorType: "MEMBER",
        userId,
        entityType: result.formId ? "HEALTH_SAFETY_FORM" : "HEALTH_SAFETY_REVISION",
        entityId: result.formId ?? result.revisionId,
        description: "Member updated their Health & Safety declaration.",
        metadata: {
          formId: result.formId,
          revisionId: result.revisionId,
          bookingId: result.bookingId,
          declarationKind: result.kind,
          // Whether notes were given, never what they say.
          notesProvided: Boolean(typeof value.notes === "string" && value.notes.trim()),
          declarationChanged: result.changed,
          upcomingBookingsUpdated: result.updatedBookings.length,
          declarationFormsCreated: result.updatedBookings.filter((item) => item.formCreated).length,
        },
      });

      // One notification per update (keyed by its revision). A resubmission
      // that changed nothing has nothing new to report.
      if (result.changed) {
        await notifyAdmins({
          userId,
          fullName: result.member.fullName,
          formId: result.formId,
          bookingId: result.bookingId,
          revisionId: result.revisionId,
          kind: result.kind,
        });
      }

      return res.status(200).json({
        success: true,
        message: result.changed
          ? "Your Health & Safety declaration has been updated."
          : "Your Health & Safety declaration is already up to date.",
        data: {
          revisionId: result.revisionId,
          ...result.view,
          // Additive: what this update changed.
          propagation: {
            changed: result.changed,
            updatedBookings: result.updatedBookings.map((item) => ({
              bookingId: item.bookingId,
              formId: item.formId,
              revisionId: item.revisionId,
              formCreated: item.formCreated,
            })),
          },
        },
      });
    } catch (caught) {
      recordFailure(
        {
          action: "health_safety.update",
          actorType: "MEMBER",
          userId,
          metadata: { declarationKind: value.bookingId ? "BOOKING" : null },
        },
        caught,
        caught instanceof HealthSafetyError ? caught.status : 500
      );
      return failure(res, caught, "health_safety.update_failed");
    }
  },

  /** GET /api/admin/health-safety */
  async adminList(req: Request, res: Response) {
    const { error, value } = adminListSchema.validate(req.query ?? {}, { abortEarly: true, convert: true });
    if (error) return validationError(res, error.details[0].message);

    try {
      const data = await healthSafetyService.adminList(value);
      return res.status(200).json({ success: true, data });
    } catch (caught) {
      return failure(res, caught, "health_safety.admin_list_failed");
    }
  },

  /** GET /api/admin/health-safety/revisions?formId=… | ?userId=… */
  async adminRevisions(req: Request, res: Response) {
    const { error, value } = revisionsSchema.validate(req.query ?? {}, { abortEarly: true });
    if (error) return validationError(res, error.details[0].message);

    try {
      const revisions = await healthSafetyService.adminRevisions(value);
      return res.status(200).json({ success: true, data: { revisions } });
    } catch (caught) {
      return failure(res, caught, "health_safety.admin_revisions_failed");
    }
  },
};

const plansSchema = Joi.object({
  type: Joi.string().valid("GROUP", "PRIVATE"),
  isActive: Joi.boolean(),
}).messages({ "object.unknown": "{{#label}} is not a supported filter." });

export const adminMembershipPlansController = {
  /**
   * GET /api/admin/memberships: every plan (GROUP and PRIVATE, active and
   * inactive). The public GET /api/memberships is unchanged.
   */
  async list(req: Request, res: Response) {
    const { error, value } = plansSchema.validate(req.query ?? {}, { abortEarly: true, convert: true });
    if (error) return validationError(res, error.details[0].message);

    try {
      const plans = await prisma.membership.findMany({
        where: {
          ...(value.type && { type: value.type }),
          ...(value.isActive !== undefined && { isActive: value.isActive }),
        },
        orderBy: [{ type: "asc" }, { displayOrder: "asc" }, { name: "asc" }],
      });

      return res.status(200).json({
        success: true,
        data: plans.map((plan) => ({
          ...plan,
          // Plan availability (not a member's membership status).
          isUnlimited: plan.classLimit === null,
        })),
      });
    } catch (caught) {
      return failure(res, caught, "admin_memberships.list_failed");
    }
  },
};
