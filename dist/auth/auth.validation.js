import Joi from "joi";
export const registerSchema = Joi.object({
    fullName: Joi.string().trim().min(3).max(100).required(),
    email: Joi.string().email().lowercase().required(),
    phone: Joi.string().trim().optional().allow("", null),
    bookingReference: Joi.string().trim().optional(),
    membership: Joi.string().trim().optional(),
    activationToken: Joi.string().trim().optional(),
    password: Joi.string().min(8).max(100).required(),
    confirmPassword: Joi.any()
        .valid(Joi.ref("password"))
        .required()
        .messages({
        "any.only": "Passwords do not match.",
    }),
}).custom((value, helpers) => {
    const hasMembership = Boolean(value.membership);
    const hasToken = Boolean(value.activationToken);
    if (hasMembership !== hasToken) {
        return helpers.error("any.custom", {
            message: "Membership number and activation token must be provided together.",
        });
    }
    return value;
}).messages({
    "any.custom": "{{#message}}",
});
export const loginSchema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required(),
});
export const forgotPasswordSchema = Joi.object({
    email: Joi.string().email().required(),
});
export const resetPasswordSchema = Joi.object({
    token: Joi.string().required(),
    password: Joi.string().min(8).required(),
    confirmPassword: Joi.any()
        .valid(Joi.ref("password"))
        .required()
        .messages({
        "any.only": "Passwords do not match.",
    }),
});
//# sourceMappingURL=auth.validation.js.map