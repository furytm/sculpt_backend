import Joi from "joi";

export const createMembershipSchema = Joi.object({
  name: Joi.string().trim().required(),

  slug: Joi.string().trim().required(),

  description: Joi.string().allow("", null),

  price: Joi.number().integer().min(0).required(),

  period: Joi.string().required(),

  classLimit: Joi.number().integer().allow(null),

  duration: Joi.string().required(),

  features: Joi.array()
    .items(Joi.string().trim())
    .required(),

  highlighted: Joi.boolean().default(false),

  badge: Joi.string().allow("", null),

  displayOrder: Joi.number().integer().default(0),

  autoRenew: Joi.boolean().default(false),

  isActive: Joi.boolean().default(true),
});

export const updateMembershipSchema = Joi.object({
  name: Joi.string().trim(),

  slug: Joi.string().trim(),

  description: Joi.string().allow("", null),

  price: Joi.number().integer().min(0),

  period: Joi.string(),

  classLimit: Joi.number().integer().allow(null),

  duration: Joi.string(),

  features: Joi.array().items(
    Joi.string().trim()
  ),

  highlighted: Joi.boolean(),

  badge: Joi.string().allow("", null),

  displayOrder: Joi.number().integer(),

  autoRenew: Joi.boolean(),

  isActive: Joi.boolean(),
}).min(1);