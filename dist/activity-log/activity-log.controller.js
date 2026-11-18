import Joi from "joi";
import { activityLogQuery, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "./activity-log.query.js";
import { ACTIVITY_STATUSES, ACTOR_TYPES, ENTITY_TYPES } from "./activity-log.types.js";
import { describeError, sendErrorResponse } from "../observability/errors.js";
import { getRequestId } from "../observability/request-context.js";
import { logger } from "../observability/logger.js";
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const CORRELATION = /^[A-Za-z0-9._:@+-]{1,100}$/;
const ACTION = /^[a-z][a-z0-9_.]{0,79}$/;
const ERROR_CODE = /^[A-Z0-9_]{1,80}$/;
/** Comma-separated values, each matching `item`. */
const list = (item) => Joi.string()
    .trim()
    .max(500)
    .custom((value, helpers) => {
    const values = value.split(",").map((part) => part.trim()).filter(Boolean);
    for (const part of values) {
        const { error } = item.validate(part);
        if (error)
            return helpers.error("any.invalid");
    }
    return values;
});
const base = {
    page: Joi.number().integer().min(1).max(100_000).default(1),
    limit: Joi.number().integer().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
    action: list(Joi.string().pattern(ACTION)),
    from: Joi.date().iso(),
    to: Joi.date().iso().when("from", { is: Joi.exist(), then: Joi.date().min(Joi.ref("from")) }),
};
const listSchema = Joi.object({
    ...base,
    search: Joi.string().trim().min(1).max(100),
    status: list(Joi.string().valid(...ACTIVITY_STATUSES)),
    actorType: list(Joi.string().valid(...ACTOR_TYPES)),
    subjectUserId: Joi.string().pattern(ID),
    subjectEmail: Joi.string().trim().lowercase().email().max(254),
    entityType: list(Joi.string().valid(...ENTITY_TYPES)),
    entityId: Joi.string().pattern(ID),
    correlationId: Joi.string().pattern(CORRELATION),
    requestId: Joi.string().pattern(CORRELATION),
    paymentReference: Joi.string().pattern(CORRELATION),
});
const errorsSchema = Joi.object({
    ...base,
    search: Joi.string().trim().min(1).max(100),
    errorCode: Joi.string().pattern(ERROR_CODE),
    httpStatus: Joi.number().integer().min(100).max(599),
    subjectUserId: Joi.string().pattern(ID),
    correlationId: Joi.string().pattern(CORRELATION),
    requestId: Joi.string().pattern(CORRELATION),
    includeWarnings: Joi.boolean().default(false),
});
const memberSchema = Joi.object({
    ...base,
    status: list(Joi.string().valid(...ACTIVITY_STATUSES)),
    entityType: list(Joi.string().valid(...ENTITY_TYPES)),
});
const MESSAGES = {
    "number.max": "{{#label}} must be at most {{#limit}}.",
    "date.min": "\"to\" must not be before \"from\".",
    "any.invalid": "{{#label}} contains an invalid value.",
    "object.unknown": "{{#label}} is not a supported filter.",
    "string.pattern.base": "{{#label}} has an invalid format.",
};
function validate(schema, input) {
    const { error, value } = schema.validate(input ?? {}, {
        abortEarly: true,
        convert: true,
        messages: MESSAGES,
    });
    return error ? { ok: false, message: error.details[0].message } : { ok: true, value: value };
}
function validationError(res, message) {
    return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message,
        requestId: getRequestId(),
    });
}
function serverError(res, error, event) {
    const description = describeError(error, 500);
    logger.error(event, {
        errorCode: description.code,
        errorMessage: description.logMessage,
        stack: description.logStack,
    });
    // Never a database or internal message.
    return sendErrorResponse(res, description.kind === "business" ? { ...description, kind: "internal", httpStatus: 500, publicMessage: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" } : description, { success: false });
}
export const activityLogController = {
    /** GET /api/admin/activity-logs */
    async list(req, res) {
        const parsed = validate(listSchema, req.query);
        if (!parsed.ok)
            return validationError(res, parsed.message);
        try {
            const data = await activityLogQuery.list(parsed.value);
            return res.status(200).json({ success: true, data });
        }
        catch (error) {
            return serverError(res, error, "activity_logs.list_failed");
        }
    },
    /** GET /api/admin/activity-logs/errors */
    async errors(req, res) {
        const parsed = validate(errorsSchema, req.query);
        if (!parsed.ok)
            return validationError(res, parsed.message);
        try {
            const data = await activityLogQuery.errors(parsed.value);
            return res.status(200).json({ success: true, data });
        }
        catch (error) {
            return serverError(res, error, "activity_logs.errors_failed");
        }
    },
    /** GET /api/admin/activity-logs/operations/:correlationId */
    async operation(req, res) {
        const correlationId = String(req.params.correlationId ?? "");
        if (!CORRELATION.test(correlationId)) {
            return validationError(res, "correlationId has an invalid format.");
        }
        try {
            const data = await activityLogQuery.operation(correlationId);
            if (!data) {
                return res.status(404).json({
                    success: false,
                    code: "NOT_FOUND",
                    message: "No activity was found for this operation.",
                    requestId: getRequestId(),
                });
            }
            return res.status(200).json({ success: true, data });
        }
        catch (error) {
            return serverError(res, error, "activity_logs.operation_failed");
        }
    },
    /** GET /api/admin/members/:memberId/activity-logs */
    async forMember(req, res) {
        const memberId = String(req.params.memberId ?? "");
        if (!ID.test(memberId)) {
            return validationError(res, "memberId has an invalid format.");
        }
        const parsed = validate(memberSchema, req.query);
        if (!parsed.ok)
            return validationError(res, parsed.message);
        try {
            const data = await activityLogQuery.forMember(memberId, parsed.value);
            if (!data) {
                return res.status(404).json({
                    success: false,
                    code: "NOT_FOUND",
                    message: "Member not found.",
                    requestId: getRequestId(),
                });
            }
            return res.status(200).json({ success: true, data });
        }
        catch (error) {
            return serverError(res, error, "activity_logs.member_failed");
        }
    },
};
//# sourceMappingURL=activity-log.controller.js.map