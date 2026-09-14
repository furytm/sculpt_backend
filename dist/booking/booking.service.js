import crypto from "crypto";
import prisma from "../config/prisma.js";
import paymentService from "../payment/payment.service.js";
import { PaymentMethod, PaymentStatus, BookingStatus, } from "@prisma/client";
import { googleCalendarService } from "../google-calendar/google-calendar.service.js";
class BookingService {
    // =========================================================
    // CONSTANTS
    // =========================================================
    HEALTH_DECLARATION_VERSION = "1.0";
    // =========================================================
    // BOOKING FLOW TOKEN
    // =========================================================
    /**
     * Generate a secure temporary token.
     *
     * The raw token is returned to the frontend.
     * Only the SHA-256 hash is stored in PostgreSQL.
     */
    generateBookingFlowToken() {
        const token = crypto.randomBytes(32).toString("hex");
        const tokenHash = crypto
            .createHash("sha256")
            .update(token)
            .digest("hex");
        return {
            token,
            tokenHash,
        };
    }
    /**
     * Hash a token supplied by the frontend.
     */
    hashBookingFlowToken(token) {
        return crypto
            .createHash("sha256")
            .update(token)
            .digest("hex");
    }
    /**
     * Verify that a temporary booking token belongs to
     * the specified booking.
     */
    async getBookingByFlowToken(bookingId, bookingFlowToken) {
        if (!bookingFlowToken) {
            throw new Error("Booking continuation token is required.");
        }
        const tokenHash = this.hashBookingFlowToken(bookingFlowToken);
        const booking = await prisma.booking.findFirst({
            where: {
                id: bookingId,
                bookingFlowTokenHash: tokenHash,
            },
            include: {
                membership: true,
                schedule: true,
                healthSafetyForm: true,
            },
        });
        if (!booking) {
            throw new Error("Booking session is invalid or has expired.");
        }
        return booking;
    }
    // =========================================================
    // CREATE BOOKING
    // =========================================================
    async createBooking(data) {
        const paymentReference = `SL-${Date.now()}`;
        // ---------------------------------------------------------
        // Validate membership
        // ---------------------------------------------------------
        const membership = await prisma.membership.findUnique({
            where: {
                id: data.membershipId,
            },
        });
        if (!membership) {
            throw new Error("Membership not found.");
        }
        // ---------------------------------------------------------
        // Generate secure booking continuation token
        // ---------------------------------------------------------
        const { token: bookingFlowToken, tokenHash } = this.generateBookingFlowToken();
        // ---------------------------------------------------------
        // Create booking
        // ---------------------------------------------------------
        const booking = await prisma.booking.create({
            data: {
                fullName: data.fullName,
                email: data.email,
                phone: data.phone,
                userId: null,
                classId: data.classId ?? null,
                // Schedule is selected AFTER payment.
                scheduleId: null,
                bookingDate: null,
                membershipId: membership.id,
                amount: membership.price,
                paymentMethod: data.paymentMethod === "OFFLINE"
                    ? PaymentMethod.OFFLINE
                    : PaymentMethod.PAYMISH,
                paymentReference,
                paymentStatus: PaymentStatus.PENDING,
                bookingFlowTokenHash: tokenHash,
            },
            include: {
                membership: true,
            },
        });
        // ========================================================
        // OFFLINE PAYMENT
        // ========================================================
        if (data.paymentMethod === "OFFLINE") {
            return {
                booking,
                paymentMethod: PaymentMethod.OFFLINE,
                authorizationUrl: null,
                bookingFlowToken,
            };
        }
        // ========================================================
        // PAYMISH PAYMENT
        // ========================================================
        const payment = await paymentService.initializeTransaction({
            email: booking.email,
            amount: booking.amount,
            reference: paymentReference,
        });
        return {
            booking,
            paymentMethod: PaymentMethod.PAYMISH,
            authorizationUrl: payment.data.authorization_url,
            bookingFlowToken,
        };
    }
    // =========================================================
    // GET BOOKING BY ID
    // =========================================================
    async getBookingById(id) {
        return await prisma.booking.findUnique({
            where: {
                id,
            },
            include: {
                membership: true,
                user: true,
                schedule: true,
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
    }
    // =========================================================
    // MARK BOOKING PAID
    // =========================================================
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
    // =========================================================
    // GET ALL BOOKINGS
    // =========================================================
    async getAllBookings() {
        return await prisma.booking.findMany({
            include: {
                membership: true,
                user: true,
                schedule: true,
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
    // =========================================================
    // GET BOOKING CONFIRMATION
    // =========================================================
    async getBookingConfirmation(reference) {
        const booking = await prisma.booking.findUnique({
            where: {
                paymentReference: reference,
            },
            include: {
                membership: true,
                user: true,
                schedule: true,
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
    // =========================================================
    // GET MY BOOKINGS
    // =========================================================
    async getMyBookings(userId) {
        return await prisma.booking.findMany({
            where: {
                userId,
            },
            include: {
                membership: true,
                schedule: true,
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
    // =========================================================
    // LEGACY: UPDATE BOOKING CLASS
    // =========================================================
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
        return await prisma.booking.update({
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
    }
    // =========================================================
    // LEGACY: UPDATE BOOKING PREFERENCES
    // =========================================================
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
        if (!data.preferredStartDate) {
            throw new Error("Preferred start date is required.");
        }
        const preferredStartDate = new Date(data.preferredStartDate);
        if (Number.isNaN(preferredStartDate.getTime())) {
            throw new Error("Invalid preferred start date.");
        }
        return await prisma.booking.update({
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
    }
    // =========================================================
    // HEALTH DECLARATION
    // =========================================================
    //
    // NEW FLOW:
    //
    // Customer has NOT created an account yet.
    //
    // Therefore this method uses bookingFlowToken instead
    // of userId.
    //
    // =========================================================
    async saveHealthDeclaration(bookingId, bookingFlowToken, data) {
        const booking = await this.getBookingByFlowToken(bookingId, bookingFlowToken);
        // ---------------------------------------------------------
        // Payment must be completed
        // ---------------------------------------------------------
        if (booking.paymentStatus !==
            PaymentStatus.PAID) {
            throw new Error("Health Declaration can only be completed after payment.");
        }
        // ---------------------------------------------------------
        // Checkbox is required
        // ---------------------------------------------------------
        if (data.accepted !== true) {
            throw new Error("You must accept the Health Declaration to continue.");
        }
        // ---------------------------------------------------------
        // Save declaration
        // ---------------------------------------------------------
        const healthSafetyForm = await prisma.healthSafetyForm.upsert({
            where: {
                bookingId,
            },
            create: {
                bookingId,
                // Account does not exist yet.
                userId: null,
                accepted: true,
                declarationVersion: this.HEALTH_DECLARATION_VERSION,
                notes: data.notes?.trim() || null,
                acceptedAt: new Date(),
                submittedAt: new Date(),
                // Keep legacy fields empty.
                screeningAnswers: {},
                consent: [],
            },
            update: {
                accepted: true,
                declarationVersion: this.HEALTH_DECLARATION_VERSION,
                notes: data.notes?.trim() || null,
                acceptedAt: new Date(),
                submittedAt: new Date(),
            },
        });
        return healthSafetyForm;
    }
    // =========================================================
    // ATTACH BOOKING TO ACCOUNT
    // =========================================================
    //
    // Called AFTER the customer registers/logs in.
    //
    // This connects the pre-account booking to the
    // authenticated user.
    //
    // =========================================================
    async attachBookingAccount(bookingId, userId, bookingFlowToken) {
        const booking = await this.getBookingByFlowToken(bookingId, bookingFlowToken);
        // ---------------------------------------------------------
        // Prevent attaching a booking to another account
        // ---------------------------------------------------------
        if (booking.userId &&
            booking.userId !== userId) {
            throw new Error("This booking is already attached to another account.");
        }
        // ---------------------------------------------------------
        // Attach booking + health declaration
        // ---------------------------------------------------------
        const result = await prisma.$transaction(async (tx) => {
            const updatedBooking = await tx.booking.update({
                where: {
                    id: booking.id,
                },
                data: {
                    userId,
                },
                include: {
                    membership: true,
                    schedule: true,
                    healthSafetyForm: true,
                },
            });
            await tx.healthSafetyForm.updateMany({
                where: {
                    bookingId: booking.id,
                },
                data: {
                    userId,
                },
            });
            return updatedBooking;
        });
        return result;
    }
    // =========================================================
    // SCHEDULE CAPACITY
    // =========================================================
    /**
     * Calculate how many places are currently occupied
     * for a recurring schedule during a membership period.
     *
     * We count confirmed member schedules whose membership
     * periods overlap the requested membership period.
     */
    async getScheduleAvailability(scheduleId, startDate, expiryDate) {
        const schedule = await prisma.schedule.findUnique({
            where: {
                id: scheduleId,
            },
        });
        if (!schedule) {
            throw new Error("Selected schedule was not found.");
        }
        if (!schedule.isActive) {
            return {
                schedule,
                bookedCount: schedule.capacity,
                availableSlots: 0,
                isAvailable: false,
            };
        }
        const bookedCount = await prisma.memberSchedule.count({
            where: {
                scheduleId,
                isActive: true,
                booking: {
                    bookingStatus: BookingStatus.CONFIRMED,
                    memberMembership: {
                        is: {
                            startDate: {
                                lt: expiryDate,
                            },
                            expiryDate: {
                                gt: startDate,
                            },
                        },
                    },
                },
            },
        });
        const availableSlots = Math.max(schedule.capacity - bookedCount, 0);
        return {
            schedule,
            bookedCount,
            availableSlots,
            isAvailable: availableSlots > 0,
        };
    }
    // =========================================================
    // GET CLASS SCHEDULE AVAILABILITY
    // =========================================================
    //
    // This is what the frontend can use to display:
    //
    // Thursday 2:00 PM
    // 3 / 5 booked
    // 2 spots available
    //
    // Friday 8:00 PM
    // 5 / 5 booked
    // Full
    //
    // =========================================================
    async getClassScheduleAvailability(classId, startDate, expiryDate) {
        if (!classId) {
            throw new Error("Class is required.");
        }
        const membershipStart = new Date(startDate);
        const membershipExpiry = new Date(expiryDate);
        if (Number.isNaN(membershipStart.getTime()) ||
            Number.isNaN(membershipExpiry.getTime())) {
            throw new Error("Invalid membership dates.");
        }
        const schedules = await prisma.schedule.findMany({
            where: {
                className: {
                    equals: classId,
                    mode: "insensitive",
                },
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
        const results = [];
        for (const schedule of schedules) {
            const availability = await this.getScheduleAvailability(schedule.id, membershipStart, membershipExpiry);
            results.push({
                id: schedule.id,
                className: schedule.className,
                tutorName: schedule.tutorName,
                code: schedule.code,
                dayOfWeek: schedule.dayOfWeek,
                startTime: schedule.startTime,
                endTime: schedule.endTime,
                isActive: schedule.isActive,
                capacity: schedule.capacity,
                bookedCount: availability.bookedCount,
                availableSlots: availability.availableSlots,
                isAvailable: availability.isAvailable,
            });
        }
        return results;
    }
    // =========================================================
    // SELECT SCHEDULE
    // =========================================================
    //
    // NEW FLOW:
    //
    // Customer is NOT authenticated yet.
    //
    // bookingFlowToken is used to authorize the update.
    //
    // =========================================================
    async updateBookingSchedule(bookingId, bookingFlowToken, scheduleId) {
        const booking = await this.getBookingByFlowToken(bookingId, bookingFlowToken);
        // ---------------------------------------------------------
        // Payment
        // ---------------------------------------------------------
        if (booking.paymentStatus !==
            PaymentStatus.PAID) {
            throw new Error("Your membership payment has not been completed.");
        }
        // ---------------------------------------------------------
        // Class
        // ---------------------------------------------------------
        if (!booking.classId) {
            throw new Error("Please select a class before selecting a schedule.");
        }
        // ---------------------------------------------------------
        // Start date is required to calculate membership period
        // for capacity.
        //
        // If it hasn't been selected yet, we allow schedule
        // selection but capacity will be checked again at final
        // confirmation.
        // ---------------------------------------------------------
        const schedule = await prisma.schedule.findFirst({
            where: {
                id: scheduleId,
                isActive: true,
            },
        });
        if (!schedule) {
            throw new Error("Selected schedule was not found or is no longer available.");
        }
        // ---------------------------------------------------------
        // Class match
        // ---------------------------------------------------------
        if (schedule.className.toLowerCase() !==
            booking.classId.toLowerCase()) {
            throw new Error("The selected schedule does not belong to your selected class.");
        }
        // ---------------------------------------------------------
        // If a start date already exists, perform capacity
        // check immediately.
        // ---------------------------------------------------------
        if (booking.preferredStartDate) {
            const expiryDate = this.calculateMembershipExpiry(booking.preferredStartDate, booking.membership.duration, booking.membership.period);
            const availability = await this.getScheduleAvailability(schedule.id, booking.preferredStartDate, expiryDate);
            if (!availability.isAvailable) {
                throw new Error("This schedule is currently full for the selected membership period.");
            }
        }
        // ---------------------------------------------------------
        // Save selected schedule
        // ---------------------------------------------------------
        return await prisma.booking.update({
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
    }
    // =========================================================
    // MEMBERSHIP EXPIRY CALCULATION
    // =========================================================
    calculateMembershipExpiry(startDate, duration, period) {
        const expiryDate = new Date(startDate);
        const normalizedDuration = duration
            .trim()
            .toLowerCase();
        const normalizedPeriod = period
            .trim()
            .toLowerCase();
        // ---------------------------------------------------------
        // 1. SINGLE CLASS PASS
        // ---------------------------------------------------------
        // Sculpt LAB explicitly defines this membership as:
        // "Valid for 30 days"
        //
        // duration: "Single"
        // period: "per class"
        // ---------------------------------------------------------
        if (normalizedDuration === "single" &&
            normalizedPeriod.includes("class")) {
            expiryDate.setDate(expiryDate.getDate() + 30);
            return expiryDate;
        }
        // ---------------------------------------------------------
        // 2. INTRO WEEK
        // ---------------------------------------------------------
        // duration: "1 Week"
        // period: "7 days"
        // ---------------------------------------------------------
        if (normalizedDuration === "1 week") {
            expiryDate.setDate(expiryDate.getDate() + 7);
            return expiryDate;
        }
        // ---------------------------------------------------------
        // 3. MONTHLY MEMBERSHIPS
        // ---------------------------------------------------------
        // duration: "Monthly"
        // period: "/month"
        // ---------------------------------------------------------
        if (normalizedDuration === "monthly" &&
            normalizedPeriod.includes("month")) {
            expiryDate.setMonth(expiryDate.getMonth() + 1);
            return expiryDate;
        }
        // ---------------------------------------------------------
        // 4. QUARTERLY MEMBERSHIPS
        // ---------------------------------------------------------
        // duration: "Quarterly"
        // period: "3 months"
        // ---------------------------------------------------------
        if (normalizedDuration === "quarterly" &&
            normalizedPeriod.includes("3 month")) {
            expiryDate.setMonth(expiryDate.getMonth() + 3);
            return expiryDate;
        }
        // ---------------------------------------------------------
        // 5. ANNUAL MEMBERSHIPS
        // ---------------------------------------------------------
        // duration: "Annual"
        // period: "/year"
        // ---------------------------------------------------------
        if (normalizedDuration === "annual" &&
            normalizedPeriod.includes("year")) {
            expiryDate.setFullYear(expiryDate.getFullYear() + 1);
            return expiryDate;
        }
        // ---------------------------------------------------------
        // 6. GENERIC NUMERIC PERIODS
        // ---------------------------------------------------------
        // Keeps the function flexible if we add memberships later.
        //
        // Examples:
        // duration: "3"
        // period: "months"
        //
        // duration: "2"
        // period: "weeks"
        // ---------------------------------------------------------
        const numericDuration = Number.parseInt(normalizedDuration, 10);
        if (!Number.isNaN(numericDuration) &&
            numericDuration > 0) {
            if (normalizedPeriod.includes("month")) {
                expiryDate.setMonth(expiryDate.getMonth() +
                    numericDuration);
                return expiryDate;
            }
            if (normalizedPeriod.includes("week")) {
                expiryDate.setDate(expiryDate.getDate() +
                    numericDuration * 7);
                return expiryDate;
            }
            if (normalizedPeriod.includes("day")) {
                expiryDate.setDate(expiryDate.getDate() +
                    numericDuration);
                return expiryDate;
            }
            if (normalizedPeriod.includes("year")) {
                expiryDate.setFullYear(expiryDate.getFullYear() +
                    numericDuration);
                return expiryDate;
            }
        }
        // ---------------------------------------------------------
        // PRIVATE SESSION / PACKAGE
        // ---------------------------------------------------------
        // These currently do not have a defined validity period
        // in the membership data.
        //
        // They should not silently receive an arbitrary expiry.
        // ---------------------------------------------------------
        if (normalizedDuration === "single" &&
            normalizedPeriod.includes("session")) {
            throw new Error("Private session validity period is not configured.");
        }
        if (normalizedDuration === "package" &&
            normalizedPeriod.includes("package")) {
            throw new Error("Private package validity period is not configured.");
        }
        throw new Error(`Unsupported membership duration: ${duration} (${period})`);
    }
    // =========================================================
    // UPDATE START DATE
    // =========================================================
    //
    // NEW FLOW:
    // Customer is still unauthenticated.
    //
    // =========================================================
    async updateBookingStartDate(bookingId, bookingFlowToken, startDate) {
        const booking = await this.getBookingByFlowToken(bookingId, bookingFlowToken);
        // ---------------------------------------------------------
        // Payment
        // ---------------------------------------------------------
        if (booking.paymentStatus !==
            PaymentStatus.PAID) {
            throw new Error("Your membership payment has not been completed.");
        }
        // ---------------------------------------------------------
        // Parse date
        // ---------------------------------------------------------
        const selectedDate = new Date(startDate);
        if (Number.isNaN(selectedDate.getTime())) {
            throw new Error("Invalid start date.");
        }
        // ---------------------------------------------------------
        // Prevent past dates
        // ---------------------------------------------------------
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const comparisonDate = new Date(selectedDate);
        comparisonDate.setHours(0, 0, 0, 0);
        if (comparisonDate < today) {
            throw new Error("Start date cannot be in the past.");
        }
        // ---------------------------------------------------------
        // GROUP MEMBERSHIPS
        // ---------------------------------------------------------
        // Group memberships use recurring studio schedules.
        // Calculate the membership validity period and make sure
        // the selected schedule has enough capacity.
        // ---------------------------------------------------------
        if (booking.membership.type ===
            "GROUP" &&
            booking.scheduleId) {
            const expiryDate = this.calculateMembershipExpiry(selectedDate, booking.membership.duration, booking.membership.period);
            const availability = await this.getScheduleAvailability(booking.scheduleId, selectedDate, expiryDate);
            if (!availability.isAvailable) {
                throw new Error("This schedule is full for the selected membership period.");
            }
        }
        // ---------------------------------------------------------
        // PRIVATE MEMBERSHIPS
        // ---------------------------------------------------------
        // Private memberships use flexible scheduling.
        // We do not calculate membership expiry or recurring
        // schedule capacity here.
        //
        // The selected start date is accepted after validating
        // that it is not in the past.
        // ---------------------------------------------------------
        // ---------------------------------------------------------
        // Save start date
        // ---------------------------------------------------------
        const updatedBooking = await prisma.booking.update({
            where: {
                id: booking.id,
            },
            data: {
                preferredStartDate: selectedDate,
            },
            include: {
                membership: true,
                schedule: true,
            },
        });
        return updatedBooking;
    }
    // =========================================================
    // FINAL CONFIRMATION
    // =========================================================
    //
    // Customer is authenticated here.
    //
    // Required:
    // - paid
    // - class
    // - health declaration
    // - start date
    //
    // GROUP:
    // - schedule required
    // - capacity checked
    // - membership activated
    // - one MemberSchedule created
    // - booking confirmed
    // - one recurring Google Calendar event created
    //
    // PRIVATE:
    // - schedule NOT required
    // - no capacity check
    // - no membership expiry calculation
    // - no MemberSchedule
    // - no Google Calendar recurring event
    // - membership activated
    // - booking confirmed
    //
    // =========================================================
    async confirmBooking(bookingId, userId) {
        // =========================================================
        // GET BOOKING
        // =========================================================
        const booking = await prisma.booking.findFirst({
            where: {
                id: bookingId,
                userId,
            },
            include: {
                membership: true,
                memberMembership: true,
                memberSchedules: {
                    where: {
                        isActive: true,
                    },
                    include: {
                        schedule: true,
                    },
                },
                schedule: true,
                healthSafetyForm: true,
            },
        });
        if (!booking) {
            throw new Error("Booking not found or does not belong to you.");
        }
        // =========================================================
        // PAYMENT
        // =========================================================
        if (booking.paymentStatus !==
            PaymentStatus.PAID) {
            throw new Error("This booking has not been paid for.");
        }
        // =========================================================
        // CLASS
        // =========================================================
        if (!booking.classId) {
            throw new Error("Please select a class before confirming your booking.");
        }
        // =========================================================
        // START DATE
        // =========================================================
        if (!booking.preferredStartDate) {
            throw new Error("Please select a start date before confirming your booking.");
        }
        // =========================================================
        // HEALTH DECLARATION
        // =========================================================
        if (!booking.healthSafetyForm ||
            !booking.healthSafetyForm.accepted) {
            throw new Error("Please complete the Health Declaration before confirming your booking.");
        }
        // =========================================================
        // ALREADY CONFIRMED
        // =========================================================
        if (booking.bookingStatus ===
            BookingStatus.CONFIRMED) {
            return booking;
        }
        // =========================================================
        // PRIVATE MEMBERSHIP
        // =========================================================
        //
        // PRIVATE memberships do NOT use:
        // - recurring group schedules
        // - group capacity
        // - membership expiry calculation
        // - MemberSchedule
        // - recurring Google Calendar events
        //
        // They simply become ACTIVE from the selected
        // preferred start date.
        //
        // =========================================================
        if (booking.membership.type ===
            "PRIVATE") {
            const confirmedPrivateBooking = await prisma.$transaction(async (tx) => {
                // -----------------------------------------------------
                // RELOAD BOOKING INSIDE TRANSACTION
                // -----------------------------------------------------
                const currentBooking = await tx.booking.findUnique({
                    where: {
                        id: booking.id,
                    },
                    include: {
                        membership: true,
                        memberMembership: true,
                        healthSafetyForm: true,
                    },
                });
                if (!currentBooking) {
                    throw new Error("Booking not found.");
                }
                // -----------------------------------------------------
                // MAKE SURE BOOKING BELONGS TO USER
                // -----------------------------------------------------
                if (currentBooking.userId !==
                    userId) {
                    throw new Error("This booking does not belong to your account.");
                }
                // -----------------------------------------------------
                // RECHECK PAYMENT
                // -----------------------------------------------------
                if (currentBooking.paymentStatus !==
                    PaymentStatus.PAID) {
                    throw new Error("This booking has not been paid for.");
                }
                // -----------------------------------------------------
                // RECHECK CLASS
                // -----------------------------------------------------
                if (!currentBooking.classId) {
                    throw new Error("Please select a class before confirming your booking.");
                }
                // -----------------------------------------------------
                // RECHECK START DATE
                // -----------------------------------------------------
                if (!currentBooking.preferredStartDate) {
                    throw new Error("Please select a start date before confirming your booking.");
                }
                // -----------------------------------------------------
                // RECHECK HEALTH DECLARATION
                // -----------------------------------------------------
                if (!currentBooking.healthSafetyForm ||
                    !currentBooking.healthSafetyForm.accepted) {
                    throw new Error("Please complete the Health Declaration before confirming your booking.");
                }
                // -----------------------------------------------------
                // ALREADY CONFIRMED
                // -----------------------------------------------------
                if (currentBooking.bookingStatus ===
                    BookingStatus.CONFIRMED) {
                    return currentBooking;
                }
                // -----------------------------------------------------
                // CREATE / UPDATE PRIVATE MEMBERSHIP
                // -----------------------------------------------------
                //
                // IMPORTANT:
                // expiryDate remains NULL because the current
                // PRIVATE membership catalog does not define a
                // validity period.
                //
                // -----------------------------------------------------
                let memberMembership = currentBooking.memberMembership;
                if (!memberMembership) {
                    memberMembership =
                        await tx.memberMembership.create({
                            data: {
                                userId,
                                bookingId: currentBooking.id,
                                membershipId: currentBooking.membershipId,
                                status: "ACTIVE",
                                startDate: currentBooking.preferredStartDate,
                                expiryDate: null,
                            },
                        });
                }
                else {
                    memberMembership =
                        await tx.memberMembership.update({
                            where: {
                                id: memberMembership.id,
                            },
                            data: {
                                userId,
                                membershipId: currentBooking.membershipId,
                                status: "ACTIVE",
                                startDate: currentBooking.preferredStartDate,
                                expiryDate: null,
                            },
                        });
                }
                // -----------------------------------------------------
                // CONFIRM PRIVATE BOOKING
                // -----------------------------------------------------
                const confirmed = await tx.booking.update({
                    where: {
                        id: currentBooking.id,
                    },
                    data: {
                        bookingStatus: BookingStatus.CONFIRMED,
                        preferredStartDate: currentBooking.preferredStartDate,
                    },
                    include: {
                        membership: true,
                        memberMembership: true,
                        schedule: true,
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
                return confirmed;
            });
            // ---------------------------------------------------------
            // PRIVATE BOOKINGS DO NOT CREATE GOOGLE CALENDAR
            // RECURRING GROUP EVENTS.
            // ---------------------------------------------------------
            return confirmedPrivateBooking;
        }
        // =========================================================
        // GROUP MEMBERSHIP
        // =========================================================
        //
        // Everything below remains the existing GROUP booking
        // behavior:
        //
        // - schedule required
        // - expiry calculated
        // - capacity checked
        // - MemberMembership activated
        // - selected MemberSchedule created
        // - booking confirmed
        // - recurring Google Calendar event created
        //
        // =========================================================
        // =========================================================
        // SCHEDULE
        // =========================================================
        if (!booking.scheduleId) {
            throw new Error("Please select an available schedule before confirming your booking.");
        }
        if (!booking.schedule) {
            throw new Error("Selected schedule could not be found.");
        }
        // =========================================================
        // MEMBERSHIP PERIOD
        // =========================================================
        const membershipStart = booking.preferredStartDate;
        const membershipExpiry = this.calculateMembershipExpiry(membershipStart, booking.membership.duration, booking.membership.period);
        // =========================================================
        // IMPORTANT:
        // CONCURRENT CAPACITY PROTECTION
        // =========================================================
        //
        // We use a PostgreSQL row lock on the Schedule.
        //
        // If two people try to take the last available slot
        // at exactly the same time:
        //
        // Customer A:
        //   locks Schedule
        //   checks capacity
        //   creates MemberSchedule
        //   commits
        //
        // Customer B:
        //   waits for Schedule lock
        //   gets the lock after A commits
        //   checks capacity again
        //   sees that the schedule is now full
        //   fails safely
        //
        // This prevents the "two people got the last slot"
        // race condition.
        //
        // =========================================================
        const confirmedBooking = await prisma.$transaction(async (tx) => {
            // -----------------------------------------------------
            // LOCK THE SCHEDULE ROW
            // -----------------------------------------------------
            await tx.$queryRaw `
          SELECT id
          FROM "Schedule"
          WHERE id = ${booking.scheduleId}
          FOR UPDATE
        `;
            // -----------------------------------------------------
            // RELOAD THE BOOKING INSIDE THE TRANSACTION
            // -----------------------------------------------------
            const currentBooking = await tx.booking.findUnique({
                where: {
                    id: booking.id,
                },
                include: {
                    membership: true,
                    memberMembership: true,
                    healthSafetyForm: true,
                    schedule: true,
                    memberSchedules: {
                        where: {
                            isActive: true,
                        },
                        include: {
                            schedule: true,
                        },
                    },
                },
            });
            if (!currentBooking) {
                throw new Error("Booking not found.");
            }
            // -----------------------------------------------------
            // MAKE SURE BOOKING BELONGS TO USER
            // -----------------------------------------------------
            if (currentBooking.userId !==
                userId) {
                throw new Error("This booking does not belong to your account.");
            }
            // -----------------------------------------------------
            // CHECK IF ALREADY CONFIRMED
            // -----------------------------------------------------
            if (currentBooking.bookingStatus ===
                BookingStatus.CONFIRMED) {
                return currentBooking;
            }
            // -----------------------------------------------------
            // RECHECK PAYMENT
            // -----------------------------------------------------
            if (currentBooking.paymentStatus !==
                PaymentStatus.PAID) {
                throw new Error("This booking has not been paid for.");
            }
            // -----------------------------------------------------
            // RECHECK REQUIRED BOOKING DATA
            // -----------------------------------------------------
            if (!currentBooking.classId) {
                throw new Error("Please select a class before confirming your booking.");
            }
            if (!currentBooking.preferredStartDate) {
                throw new Error("Please select a start date before confirming your booking.");
            }
            if (!currentBooking.healthSafetyForm ||
                !currentBooking.healthSafetyForm.accepted) {
                throw new Error("Please complete the Health Declaration before confirming your booking.");
            }
            if (!currentBooking.scheduleId) {
                throw new Error("Please select an available schedule before confirming your booking.");
            }
            if (!currentBooking.schedule) {
                throw new Error("Selected schedule could not be found.");
            }
            // -----------------------------------------------------
            // MAKE SURE THE SCHEDULE IS STILL ACTIVE
            // -----------------------------------------------------
            if (!currentBooking.schedule.isActive) {
                throw new Error("This schedule is no longer available.");
            }
            // -----------------------------------------------------
            // MAKE SURE SCHEDULE MATCHES CLASS
            // -----------------------------------------------------
            if (currentBooking.schedule.className.toLowerCase() !==
                currentBooking.classId.toLowerCase()) {
                throw new Error("The selected schedule does not belong to your selected class.");
            }
            // -----------------------------------------------------
            // CALCULATE MEMBERSHIP PERIOD
            // -----------------------------------------------------
            const currentMembershipStart = currentBooking.preferredStartDate;
            const currentMembershipExpiry = this.calculateMembershipExpiry(currentMembershipStart, currentBooking.membership.duration, currentBooking.membership.period);
            // =====================================================
            // CAPACITY CHECK WHILE SCHEDULE IS LOCKED
            // =====================================================
            const bookedCount = await tx.memberSchedule.count({
                where: {
                    scheduleId: currentBooking.scheduleId,
                    isActive: true,
                    booking: {
                        bookingStatus: BookingStatus.CONFIRMED,
                        memberMembership: {
                            is: {
                                startDate: {
                                    lt: currentMembershipExpiry,
                                },
                                expiryDate: {
                                    gt: currentMembershipStart,
                                },
                            },
                        },
                    },
                },
            });
            // -----------------------------------------------------
            // CAPACITY
            // -----------------------------------------------------
            const capacity = currentBooking.schedule.capacity;
            const availableSlots = Math.max(capacity - bookedCount, 0);
            // -----------------------------------------------------
            // CHECK WHETHER THIS BOOKING ALREADY HAS THE SLOT
            // -----------------------------------------------------
            const alreadyAssigned = currentBooking.memberSchedules.some((memberSchedule) => memberSchedule.scheduleId ===
                currentBooking.scheduleId &&
                memberSchedule.isActive);
            // -----------------------------------------------------
            // FULL
            // -----------------------------------------------------
            if (availableSlots <= 0 &&
                !alreadyAssigned) {
                throw new Error("This schedule has just become full. Please select another available schedule.");
            }
            // =====================================================
            // DEACTIVATE OLD MEMBER SCHEDULES
            // =====================================================
            await tx.memberSchedule.updateMany({
                where: {
                    bookingId: currentBooking.id,
                },
                data: {
                    isActive: false,
                },
            });
            // =====================================================
            // CREATE / UPDATE MEMBER MEMBERSHIP
            // =====================================================
            let memberMembership = currentBooking.memberMembership;
            if (!memberMembership) {
                memberMembership =
                    await tx.memberMembership.create({
                        data: {
                            userId,
                            bookingId: currentBooking.id,
                            membershipId: currentBooking.membershipId,
                            startDate: currentMembershipStart,
                            expiryDate: currentMembershipExpiry,
                            status: "ACTIVE",
                        },
                    });
            }
            else {
                memberMembership =
                    await tx.memberMembership.update({
                        where: {
                            id: memberMembership.id,
                        },
                        data: {
                            userId,
                            membershipId: currentBooking.membershipId,
                            startDate: currentMembershipStart,
                            expiryDate: currentMembershipExpiry,
                            status: "ACTIVE",
                        },
                    });
            }
            // =====================================================
            // CREATE ONLY THE SELECTED RECURRING SCHEDULE
            // =====================================================
            await tx.memberSchedule.create({
                data: {
                    userId,
                    bookingId: currentBooking.id,
                    scheduleId: currentBooking.scheduleId,
                    classId: currentBooking.classId,
                    startDate: currentMembershipStart,
                    isActive: true,
                },
            });
            // =====================================================
            // CONFIRM BOOKING
            // =====================================================
            const confirmed = await tx.booking.update({
                where: {
                    id: currentBooking.id,
                },
                data: {
                    bookingStatus: BookingStatus.CONFIRMED,
                    preferredStartDate: currentMembershipStart,
                },
                include: {
                    membership: true,
                    memberMembership: true,
                    schedule: true,
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
            return confirmed;
        });
        // =========================================================
        // GOOGLE CALENDAR
        // =========================================================
        //
        // GROUP ONLY
        //
        // One selected recurring schedule =
        // one recurring Google Calendar event.
        //
        // =========================================================
        try {
            const schedule = confirmedBooking.schedule;
            if (schedule) {
                const calendarEvent = await googleCalendarService
                    .createRecurringBookingEvent({
                    bookingId: confirmedBooking.id,
                    bookingReference: confirmedBooking.paymentReference,
                    memberName: confirmedBooking.fullName,
                    memberEmail: confirmedBooking.email,
                    className: schedule.className,
                    tutorName: schedule.tutorName,
                    bookingDate: confirmedBooking
                        .preferredStartDate,
                    expiryDate: confirmedBooking
                        .memberMembership
                        ?.expiryDate ??
                        membershipExpiry,
                    dayOfWeek: schedule.dayOfWeek,
                    startTime: schedule.startTime,
                    endTime: schedule.endTime,
                });
                // -------------------------------------------------------
                // SAVE CALENDAR EVENT
                // -------------------------------------------------------
                if (calendarEvent.eventId) {
                    await prisma.booking.update({
                        where: {
                            id: confirmedBooking.id,
                        },
                        data: {
                            calendarEventId: JSON.stringify([
                                calendarEvent.eventId,
                            ]),
                            calendarEventUrl: JSON.stringify([
                                calendarEvent.eventUrl,
                            ]),
                        },
                    });
                    confirmedBooking.calendarEventId =
                        JSON.stringify([
                            calendarEvent.eventId,
                        ]);
                    confirmedBooking.calendarEventUrl =
                        JSON.stringify([
                            calendarEvent.eventUrl,
                        ]);
                }
                console.log(`✅ Google Calendar event created for booking ${confirmedBooking.id}`);
            }
        }
        catch (calendarError) {
            console.error(`⚠️ Google Calendar event creation failed for booking ${confirmedBooking.id}:`, calendarError);
            // -------------------------------------------------------
            // IMPORTANT:
            // Booking remains CONFIRMED even if Google Calendar fails.
            // -------------------------------------------------------
        }
        return confirmedBooking;
    }
    // =========================================================
    // LEGACY HEALTH & SAFETY FORM
    // =========================================================
    //
    // Kept temporarily so existing frontend code does not
    // immediately break.
    //
    // New frontend should use saveHealthDeclaration().
    //
    // =========================================================
    async saveHealthSafetyForm(bookingId, userId, data) {
        const booking = await prisma.booking.findFirst({
            where: {
                id: bookingId,
                userId,
            },
        });
        if (!booking) {
            throw new Error("Booking not found or does not belong to you.");
        }
        if (booking.paymentStatus !==
            PaymentStatus.PAID) {
            throw new Error("Health & Safety information can only be submitted for a paid booking.");
        }
        const healthSafetyForm = await prisma.healthSafetyForm.upsert({
            where: {
                bookingId,
            },
            create: {
                bookingId,
                userId,
                dateOfBirth: data.dateOfBirth
                    ? new Date(data.dateOfBirth)
                    : null,
                age: data.age ?? null,
                emergencyContactName: data.emergencyContactName ||
                    null,
                emergencyContactRelationship: data.emergencyContactRelationship ||
                    null,
                emergencyContactPhone: data.emergencyContactPhone ||
                    null,
                pregnancy: data.pregnancy || null,
                pregnancyWeeks: data.pregnancyWeeks ?? null,
                dueDate: data.dueDate
                    ? new Date(data.dueDate)
                    : null,
                pregnancyClearance: data.pregnancyClearance || null,
                postpartum: data.postpartum || null,
                deliveryDate: data.deliveryDate
                    ? new Date(data.deliveryDate)
                    : null,
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
                dateOfBirth: data.dateOfBirth
                    ? new Date(data.dateOfBirth)
                    : null,
                age: data.age ?? null,
                emergencyContactName: data.emergencyContactName ||
                    null,
                emergencyContactRelationship: data.emergencyContactRelationship ||
                    null,
                emergencyContactPhone: data.emergencyContactPhone ||
                    null,
                pregnancy: data.pregnancy || null,
                pregnancyWeeks: data.pregnancyWeeks ?? null,
                dueDate: data.dueDate
                    ? new Date(data.dueDate)
                    : null,
                pregnancyClearance: data.pregnancyClearance || null,
                postpartum: data.postpartum || null,
                deliveryDate: data.deliveryDate
                    ? new Date(data.deliveryDate)
                    : null,
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
    // =========================================================
    // LEGACY: ASSIGN ALL SCHEDULES
    // =========================================================
    //
    // DO NOT USE THIS FOR THE NEW BOOKING FLOW.
    //
    // Kept temporarily for backwards compatibility.
    //
    // =========================================================
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
        await prisma.memberSchedule.deleteMany({
            where: {
                bookingId,
            },
        });
        await prisma.memberSchedule.createMany({
            data: schedules.map((schedule) => ({
                userId,
                bookingId,
                scheduleId: schedule.id,
                classId: booking.classId,
                startDate: booking.preferredStartDate ??
                    null,
                isActive: true,
            })),
        });
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
}
export default new BookingService();
//# sourceMappingURL=booking.service.js.map