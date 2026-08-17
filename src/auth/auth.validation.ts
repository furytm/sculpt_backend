import Joi from "joi";

export const registerSchema = Joi.object({
  fullName: Joi.string().trim().min(3).max(100).required(),

  email: Joi.string().email().lowercase().required(),

  phone: Joi.string().trim().optional().allow("", null),
  bookingReference: Joi.string().trim().optional(),

  password: Joi.string().min(8).max(100).required(),

  confirmPassword: Joi.any()
    .valid(Joi.ref("password"))
    .required()
    .messages({
      "any.only": "Passwords do not match.",
    }),
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
