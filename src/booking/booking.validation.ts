import Joi from "joi";



export const createBookingSchema = Joi.object({
  fullName: Joi.string().trim().min(3).max(100).required(),

  email: Joi.string()
    .email()
    .lowercase()
    .required(),

  phone: Joi.string()
    .trim()
    .required(),

  membershipId: Joi.string()
    .trim()
    .required(),

  classId: Joi.string()
    .trim()
    .optional()
    .allow("", null),

  scheduleId: Joi.string()
    .trim()
    .optional()
    .allow("", null),

  bookingDate: Joi.string()
    .isoDate()
    .optional()
    .allow(null),

  paymentMethod: Joi.string()
    .valid("PAYMISH", "OFFLINE")
    .required(),

  healthDeclaration: Joi.object({
    accepted: Joi.boolean()
      .valid(true)
      .required(),

    notes: Joi.string()
      .trim()
      .max(1000)
      .optional()
      .allow(""),
  }).required(),
});

export const updateBookingPreferencesSchema =
  Joi.object({
    classId: Joi.string()
      .trim()
      .required(),

    preferredStartDate: Joi.date()
      .iso()
      .required(),

    availableDays: Joi.array()
      .items(
        Joi.string().valid(
          "MONDAY",
          "TUESDAY",
          "WEDNESDAY",
          "THURSDAY",
          "FRIDAY",
          "SATURDAY",
          "SUNDAY"
        )
      )
      .min(1)
      .required(),

    preferredTimes: Joi.array()
      .items(
        Joi.string().valid(
          "MORNING",
          "AFTERNOON",
          "EVENING"
        )
      )
      .min(1)
      .required(),
  });
