import Joi from "joi";

export const createBookingSchema = Joi.object({
  fullName: Joi.string().trim().required(),

  email: Joi.string()
    .email()
    .required(),

  phone: Joi.string()
    .trim()
    .required(),

  membershipId: Joi.string()
    .required(),

  classId: Joi.string()
    .required(),

  scheduleId: Joi.string()
    .allow(null, "")
    .optional(),

  bookingDate: Joi.date()
    .allow(null)
    .optional(),
});



export const updateBookingPreferencesSchema =
  Joi.object({
    preferredStartDate: Joi.string()
      .isoDate()
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