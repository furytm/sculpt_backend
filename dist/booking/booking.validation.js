import Joi from "joi";
export const createBookingSchema = Joi.object({
    fullName: Joi.string().trim().required(),
    email: Joi.string().email().required(),
    phone: Joi.string().required(),
    classId: Joi.string().required(),
    scheduleId: Joi.string().required(),
    bookingDate: Joi.date().required(),
});
//# sourceMappingURL=booking.validation.js.map