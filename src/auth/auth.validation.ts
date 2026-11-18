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
      message:
        "Membership number and activation token must be provided together.",
    });
  }

  return value;
}).messages({
  "any.custom": "{{#message}}",
});


export const loginSchema = Joi.object({
  email: Joi.string().email().lowercase().trim().required(),

  password: Joi.string().required(),

  bookingReference: Joi.string().trim().optional(),
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

// PATCH /api/auth/profile. The email is changed through
// /api/auth/email-change instead (the controller rejects it first).
export const updateProfileSchema = Joi.object({
  fullName: Joi.string().trim().min(3).max(100),

  phone: Joi.string()
    .trim()
    .allow("")
    .pattern(/^\+?[0-9()\-\s]{7,20}$/)
    .messages({
      "string.pattern.base": "Please enter a valid phone number.",
    }),
})
  .min(1)
  .messages({
    "object.min": "Please provide at least one field to update.",
    "object.unknown": "{{#label}} can't be updated here.",
  });

export const emailChangeRequestSchema = Joi.object({
  newEmail: Joi.string().trim().lowercase().email().max(254).required().messages({
    "string.email": "Please enter a valid email address.",
    "any.required": "A new email address is required.",
    "string.empty": "A new email address is required.",
  }),

  // Required for password accounts; checked in the service so a Google
  // account gets a clear "managed by Google" answer instead.
  currentPassword: Joi.string().max(200),
});

export const emailChangeCodeSchema = Joi.object({
  code: Joi.string()
    .trim()
    .pattern(/^\d{6}$/)
    .required()
    .messages({
      "string.pattern.base": "Please enter the 6-digit code.",
      "any.required": "Please enter the 6-digit code.",
      "string.empty": "Please enter the 6-digit code.",
    }),
});
