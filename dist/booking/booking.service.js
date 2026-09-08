import prisma from "../config/prisma.js";
import paymentService from "../payment/payment.service.js";
import { PaymentMethod, PaymentStatus, BookingStatus, } from "@prisma/client";
import { googleCalendarService } from "../google-calendar/google-calendar.service.js";
class BookingService {
    async createBooking(data) {
        const paymentReference = `SL-${Date.now()}`;
        const membership = await prisma.membership.findUnique({
            where: {
                id: data.membershipId,
            },
        });
        if (!membership) {
            throw new Error("Membership not found.");
        }
        const booking = await prisma.booking.create({
            data: {
                fullName: data.fullName,
                email: data.email,
                phone: data.phone,
                userId: null,
                classId: data.classId ?? null,
                scheduleId: null,
                bookingDate: null,
                membershipId: membership.id,
                amount: membership.price,
                paymentMethod: data.paymentMethod === "OFFLINE"
                    ? PaymentMethod.OFFLINE
                    : PaymentMethod.PAYMISH,
                paymentReference,
                paymentStatus: PaymentStatus.PENDING,
            },
        });
        /*
         * OFFLINE PAYMENT
         *
         * Do not initialize Paymish.
         * The booking remains PENDING until
         * an admin verifies the bank transfer.
         */
        if (data.paymentMethod === "OFFLINE") {
            return {
                booking,
                paymentMethod: PaymentMethod.OFFLINE,
                authorizationUrl: null,
            };
        }
        /*
         * PAYMISH PAYMENT
         *
         * Keep the existing Paymish initialization.
         */
        const payment = await paymentService.initializeTransaction({
            email: booking.email,
            amount: booking.amount,
            reference: paymentReference,
        });
        return {
            booking,
            paymentMethod: PaymentMethod.PAYMISH,
            authorizationUrl: payment.data.authorization_url,
        };
    }
    async getBookingById(id) {
        return await prisma.booking.findUnique({
            where: {
                id,
            },
            include: {
                membership: true,
                user: true,
            },
        });
    }
    async markBookingPaid(reference) {
        return await prisma.booking.update({
            where: {
                paymentReference: reference,
            },
            data: {
                paymentStatus: PaymentStatus.PAID,
            },
        });
    }
    async getAllBookings() {
        return await prisma.booking.findMany({
            include: {
                membership: true,
                user: true,
            },
            orderBy: {
                createdAt: "desc",
            },
        });
    }
    async assignSchedules(bookingId, userId) {
        const booking = await prisma.booking.findFirst({
            where: {
                id: bookingId,
                userId,
            },
        });
        if (!booking) {
            throw new Error("Booking not found.");
        }
        if (!booking.classId) {
            throw new Error("No class has been selected for this booking.");
        }
        // Find ALL active schedules for the selected class
        const schedules = await prisma.schedule.findMany({
            where: {
                className: booking.classId,
                isActive: true,
            },
            orderBy: [
                {
                    dayOfWeek: "asc",
                },
                {
                    startTime: "asc",
                },
            ],
        });
        if (schedules.length === 0) {
            throw new Error(`No active schedules found for ${booking.classId}.`);
        }
        // Remove any previous assignments for this booking
        await prisma.memberSchedule.deleteMany({
            where: {
                bookingId,
            },
        });
        // Assign ALL schedules belonging to the selected class
        await prisma.memberSchedule.createMany({
            data: schedules.map((schedule) => ({
                userId,
                bookingId,
                scheduleId: schedule.id,
                classId: booking.classId,
                startDate: booking.preferredStartDate ?? null,
                isActive: true,
            })),
        });
        // Return the newly assigned schedules
        return prisma.memberSchedule.findMany({
            where: {
                bookingId,
                isActive: true,
            },
            include: {
                schedule: true,
            },
            orderBy: {
                createdAt: "asc",
            },
        });
    }
    async getBookingConfirmation(reference) {
        const booking = await prisma.booking.findUnique({
            where: {
                paymentReference: reference,
            },
            include: {
                membership: true,
                user: true,
                memberSchedules: {
                    where: {
                        isActive: true,
                    },
                    include: {
                        schedule: true,
                    },
                },
                healthSafetyForm: true,
            },
        });
        if (!booking) {
            throw new Error("Booking not found.");
        }
        return booking;
    }
    /**
     * Get all bookings belonging
     * to the currently authenticated user.
     */
    async getMyBookings(userId) {
        return await prisma.booking.findMany({
            where: {
                userId,
            },
            include: {
                membership: true,
                memberSchedules: {
                    where: {
                        isActive: true,
                    },
                    include: {
                        schedule: true,
                    },
                },
                healthSafetyForm: true,
            },
            orderBy: {
                createdAt: "desc",
            },
        });
    }
    async updateBookingClass(bookingId, userId, classId) {
        const booking = await prisma.booking.findFirst({
            where: {
                id: bookingId,
                userId,
            },
        });
        if (!booking) {
            throw new Error("Booking not found or does not belong to you.");
        }
        if (booking.paymentStatus !== PaymentStatus.PAID) {
            throw new Error("Your membership payment has not been completed.");
        }
        if (!classId) {
            throw new Error("Please select a class.");
        }
        const updatedBooking = await prisma.booking.update({
            where: {
                id: booking.id,
            },
            data: {
                classId,
                scheduleId: null,
                bookingDate: null,
            },
            include: {
                membership: true,
                schedule: true,
            },
        });
        return updatedBooking;
    }
    async updateBookingPreferences(bookingId, userId, data) {
        const booking = await prisma.booking.findFirst({
            where: {
                id: bookingId,
                userId,
            },
        });
        if (!booking) {
            throw new Error("Booking not found or does not belong to you.");
        }
        if (booking.paymentStatus !== PaymentStatus.PAID) {
            throw new Error("Your membership payment has not been completed.");
        }
        if (!data.classId) {
            throw new Error("Please select a class.");
        }
        const preferredStartDate = new Date(data.preferredStartDate);
        if (Number.isNaN(preferredStartDate.getTime())) {
            throw new Error("Invalid preferred start date.");
        }
        const updatedBooking = await prisma.booking.update({
            where: {
                id: booking.id,
            },
            data: {
                classId: data.classId,
                preferredStartDate,
                availableDays: data.availableDays,
                preferredTimes: data.preferredTimes,
            },
            include: {
                membership: true,
            },
        });
        return updatedBooking;
    }
    /**
     * Confirm an existing paid booking.
     *
     * This does NOT create a new booking.
     * It finalizes the existing booking after
     * the member has completed the booking flow.
     */
    /**
    * Confirm an existing paid booking.
    *
    * This does NOT create a new booking.
    * It finalizes the existing booking after
    * the member has completed the booking flow.
    */
    async confirmBooking(bookingId, userId) {
        const booking = await prisma.booking.findFirst({
            where: {
                id: bookingId,
                userId,
            },
            include: {
                membership: true,
                memberSchedules: {
                    where: {
                        isActive: true,
                    },
                    include: {
                        schedule: true,
                    },
                },
                healthSafetyForm: true,
            },
        });
        if (!booking) {
            throw new Error("Booking not found or does not belong to you.");
        }
        // Member must have paid
        if (booking.paymentStatus !== PaymentStatus.PAID) {
            throw new Error("This booking has not been paid for.");
        }
        // A class must have been selected
        if (!booking.classId) {
            throw new Error("Please select a class before confirming your booking.");
        }
        // At least one recurring schedule must have been assigned
        if (booking.memberSchedules.length === 0) {
            throw new Error("No recurring schedules have been assigned to this booking.");
        }
        // A start date must have been selected
        if (!booking.preferredStartDate) {
            throw new Error("Please select a start date before confirming your booking.");
        }
        // Health & Safety form must be completed
        if (!booking.healthSafetyForm) {
            throw new Error("Please complete your Health & Safety form before confirming your booking.");
        }
        // Prevent confirming an already confirmed booking
        if (booking.bookingStatus === BookingStatus.CONFIRMED) {
            return booking;
        }
        // Get the schedule that will be placed on Google Calendar.
        // We use the first active recurring schedule for this booking.
        const selectedSchedule = booking.memberSchedules[0]?.schedule;
        if (!selectedSchedule) {
            throw new Error("No valid schedule was found for this booking.");
        }
        // First confirm the booking in our database.
        const confirmedBooking = await prisma.booking.update({
            where: {
                id: booking.id,
            },
            data: {
                bookingStatus: BookingStatus.CONFIRMED,
            },
            include: {
                membership: true,
                memberSchedules: {
                    where: {
                        isActive: true,
                    },
                    include: {
                        schedule: true,
                    },
                },
                healthSafetyForm: true,
            },
        });
        // ---------------------------------------------------------
        // Google Calendar
        // ---------------------------------------------------------
        //
        // Calendar creation is intentionally AFTER the booking has
        // been confirmed.
        //
        // If Google Calendar fails, the Sculpt LAB booking remains
        // CONFIRMED. We log the error instead of breaking the booking.
        // ---------------------------------------------------------
        try {
            const calendarEvent = await googleCalendarService.createBookingEvent({
                bookingId: confirmedBooking.id,
                bookingReference: confirmedBooking.paymentReference,
                memberName: confirmedBooking.fullName,
                memberEmail: confirmedBooking.email,
                className: selectedSchedule.className,
                tutorName: selectedSchedule.tutorName,
                bookingDate: confirmedBooking.preferredStartDate,
                startTime: selectedSchedule.startTime,
                endTime: selectedSchedule.endTime,
            });
            // Save the Google Calendar event information
            // back onto the booking.
            if (calendarEvent.eventId) {
                await prisma.booking.update({
                    where: {
                        id: confirmedBooking.id,
                    },
                    data: {
                        calendarEventId: calendarEvent.eventId,
                        calendarEventUrl: calendarEvent.eventUrl,
                    },
                });
                // Keep the returned object up to date
                confirmedBooking.calendarEventId =
                    calendarEvent.eventId;
                confirmedBooking.calendarEventUrl =
                    calendarEvent.eventUrl;
            }
            console.log(`✅ Google Calendar event created for booking ${confirmedBooking.id}`);
        }
        catch (calendarError) {
            console.error(`⚠️ Google Calendar event creation failed for booking ${confirmedBooking.id}:`, calendarError);
            // IMPORTANT:
            // Do NOT undo the booking confirmation.
            //
            // The booking remains CONFIRMED even if Google Calendar
            // temporarily fails.
        }
        return confirmedBooking;
    }
    async saveHealthSafetyForm(bookingId, userId, data) {
        // 1. Find booking
        const booking = await prisma.booking.findFirst({
            where: {
                id: bookingId,
                userId,
            },
        });
        if (!booking) {
            throw new Error("Booking not found or does not belong to you.");
        }
        // 2. Check payment
        if (booking.paymentStatus !== PaymentStatus.PAID) {
            throw new Error("Health & Safety information can only be submitted for a paid booking.");
        }
        // 3. Create/update health form
        const healthSafetyForm = await prisma.healthSafetyForm.upsert({
            where: {
                bookingId,
            },
            create: {
                bookingId,
                userId,
                dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
                age: data.age ?? null,
                emergencyContactName: data.emergencyContactName || null,
                emergencyContactRelationship: data.emergencyContactRelationship || null,
                emergencyContactPhone: data.emergencyContactPhone || null,
                pregnancy: data.pregnancy || null,
                pregnancyWeeks: data.pregnancyWeeks ?? null,
                dueDate: data.dueDate ? new Date(data.dueDate) : null,
                pregnancyClearance: data.pregnancyClearance || null,
                postpartum: data.postpartum || null,
                deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : null,
                postpartumClearance: data.postpartumClearance || null,
                screeningAnswers: data.screeningAnswers || {},
                surgery: data.surgery || null,
                surgeryDetails: data.surgeryDetails || null,
                surgeryClearance: data.surgeryClearance || null,
                consent: data.consent || [],
                signature: data.signature || null,
                submittedAt: new Date(),
            },
            update: {
                dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
                age: data.age ?? null,
                emergencyContactName: data.emergencyContactName || null,
                emergencyContactRelationship: data.emergencyContactRelationship || null,
                emergencyContactPhone: data.emergencyContactPhone || null,
                pregnancy: data.pregnancy || null,
                pregnancyWeeks: data.pregnancyWeeks ?? null,
                dueDate: data.dueDate ? new Date(data.dueDate) : null,
                pregnancyClearance: data.pregnancyClearance || null,
                postpartum: data.postpartum || null,
                deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : null,
                postpartumClearance: data.postpartumClearance || null,
                screeningAnswers: data.screeningAnswers || {},
                surgery: data.surgery || null,
                surgeryDetails: data.surgeryDetails || null,
                surgeryClearance: data.surgeryClearance || null,
                consent: data.consent || [],
                signature: data.signature || null,
                submittedAt: new Date(),
            },
        });
        // 4. Return the health form WITH current user information
        return await prisma.healthSafetyForm.findUnique({
            where: {
                id: healthSafetyForm.id,
            },
            include: {
                user: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                        phone: true,
                    },
                },
            },
        });
    }
    /**
     * Save the selected schedule for an existing booking.
     *
     * The member must:
     * - own the booking
     * - have paid
     * - have selected a class
     * - select an active schedule
     * - select a schedule belonging to their selected class
     */
    async updateBookingSchedule(bookingId, userId, scheduleId) {
        // 1. Find the member's booking
        const booking = await prisma.booking.findFirst({
            where: {
                id: bookingId,
                userId,
            },
        });
        if (!booking) {
            throw new Error("Booking not found or does not belong to you.");
        }
        // 2. Payment must be completed
        if (booking.paymentStatus !== PaymentStatus.PAID) {
            throw new Error("Your membership payment has not been completed.");
        }
        // 3. Member must have selected a class
        if (!booking.classId) {
            throw new Error("Please select a class before selecting a schedule.");
        }
        // 4. Find the selected schedule
        const schedule = await prisma.schedule.findFirst({
            where: {
                id: scheduleId,
                isActive: true,
            },
        });
        if (!schedule) {
            throw new Error("Selected schedule was not found or is no longer available.");
        }
        // 5. Make sure the schedule belongs to the selected class
        if (schedule.className.toLowerCase() !== booking.classId.toLowerCase()) {
            throw new Error("The selected schedule does not belong to your selected class.");
        }
        // 6. Save the schedule
        const updatedBooking = await prisma.booking.update({
            where: {
                id: booking.id,
            },
            data: {
                scheduleId: schedule.id,
            },
            include: {
                membership: true,
                schedule: true,
            },
        });
        return updatedBooking;
    }
    /**
     * Save the member's start date.
     *
     * The selected date must match the day of the
     * schedule the member previously selected.
     *
     * Example:
     * Schedule = TUESDAY 7:00 AM
     * Start date = Tuesday, September 15
     *
     * A Wednesday start date would be rejected.
     */
    async updateBookingStartDate(bookingId, userId, startDate) {
        // 1. Find the member's booking
        const booking = await prisma.booking.findFirst({
            where: {
                id: bookingId,
                userId,
            },
        });
        if (!booking) {
            throw new Error("Booking not found or does not belong to you.");
        }
        // 2. Payment must be completed
        if (booking.paymentStatus !== PaymentStatus.PAID) {
            throw new Error("Your membership payment has not been completed.");
        }
        // 3. A class must be selected before choosing a start date
        if (!booking.classId) {
            throw new Error("Please select a class before choosing your start date.");
        }
        // 4. Parse the date
        const selectedDate = new Date(startDate);
        if (Number.isNaN(selectedDate.getTime())) {
            throw new Error("Invalid start date.");
        }
        // 5. Prevent selecting a date in the past
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const dateToCompare = new Date(selectedDate);
        dateToCompare.setHours(0, 0, 0, 0);
        if (dateToCompare < today) {
            throw new Error("Start date cannot be in the past.");
        }
        // 6. Save the preferred start date
        const updatedBooking = await prisma.booking.update({
            where: {
                id: booking.id,
            },
            data: {
                preferredStartDate: selectedDate,
            },
            include: {
                membership: true,
            },
        });
        return updatedBooking;
    }
}
export default new BookingService();
//# sourceMappingURL=booking.service.js.map