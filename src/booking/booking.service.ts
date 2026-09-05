import prisma from "../config/prisma.js";
import paymentService from "../payment/payment.service.js";
import {
  BookingResponse,
  CreateBookingDto,
  PaymentStatus,UpdateBookingPreferencesDto,HealthSafetyFormDto
} from "./booking.types.js";


class BookingService {
async createBooking(
  data: CreateBookingDto,
  userId: string
): Promise<BookingResponse> {
  const paymentReference = `SL-${Date.now()}`;

  const membership = await prisma.membership.findUnique({
    where: {
      id: data.membershipId,
    },
  });

  if (!membership) {
    throw new Error("Membership not found.");
  }

console.log("🔥 CURRENT CREATE BOOKING SERVICE");
console.log("bookingDate:", data.bookingDate);
console.log("classId:", data.classId);
console.log("scheduleId:", data.scheduleId);

const booking = await prisma.booking.create({
  data: {
    fullName: data.fullName,
    email: data.email,
    phone: data.phone,

    userId: null,

    classId: null,
    scheduleId: null,
    bookingDate: null,

    membershipId: membership.id,

    amount: membership.price,

    paymentReference,
    paymentStatus: PaymentStatus.PENDING,
  },
});

  const payment = await paymentService.initializeTransaction({
    email: booking.email,
    amount: booking.amount,
    reference: paymentReference,
  });

  return {
    booking,
    authorizationUrl: payment.data.authorization_url,
  };
}

  async getBookingById(id: string) {
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

  async markBookingPaid(reference: string) {
    return await prisma.booking.update({
      where: {
        paymentReference: reference,
      },
      data: {
        paymentStatus:
          PaymentStatus.PAID,
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

  async getBookingConfirmation(
    reference: string
  ) {
    const booking =
      await prisma.booking.findUnique({
        where: {
          paymentReference: reference,
        },
        include: {
          membership: true,
          user: true,
        },
      });

    if (!booking) {
      throw new Error(
        "Booking not found."
      );
    }

    if (
      booking.paymentStatus ===
      PaymentStatus.PENDING
    ) {
      await prisma.booking.update({
        where: {
          paymentReference: reference,
        },
        data: {
          paymentStatus:
            PaymentStatus.PAID,
        },
      });

      booking.paymentStatus =
        PaymentStatus.PAID;
    }

    return booking;
  }

  /**
   * Get all bookings belonging
   * to the currently authenticated user.
   */
  async getMyBookings(userId: string) {
    return await prisma.booking.findMany({
      where: {
        userId,
      },
   include: {
  membership: true,
  schedule: true,
},
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async updateBookingClass(
  bookingId: string,
  userId: string,
  classId: string
) {
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
      // Reset schedule if the member changes class
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

async updateBookingPreferences(
  bookingId: string,
  userId: string,
  data: UpdateBookingPreferencesDto
) {
  const booking = await prisma.booking.findFirst({
    where: {
      id: bookingId,
      userId,
    },
  });

  if (!booking) {
    throw new Error(
      "Booking not found or does not belong to you."
    );
  }

  if (booking.paymentStatus !== PaymentStatus.PAID) {
    throw new Error(
      "Your membership payment has not been completed."
    );
  }

  if (!data.classId) {
    throw new Error("Please select a class.");
  }

  const preferredStartDate =
    new Date(data.preferredStartDate);

  if (Number.isNaN(preferredStartDate.getTime())) {
    throw new Error(
      "Invalid preferred start date."
    );
  }

  const updatedBooking =
    await prisma.booking.update({
      where: {
        id: booking.id,
      },
      data: {
        classId: data.classId,

        preferredStartDate,

        availableDays:
          data.availableDays,

        preferredTimes:
          data.preferredTimes,
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
async confirmBooking(
  bookingId: string,
  userId: string
) {
  const booking =
    await prisma.booking.findFirst({
      where: {
        id: bookingId,
        userId,
      },
      include: {
        schedule: true,
      },
    });

  if (!booking) {
    throw new Error(
      "Booking not found or does not belong to you."
    );
  }

  // Member must have paid
  if (
    booking.paymentStatus !==
    PaymentStatus.PAID
  ) {
    throw new Error(
      "This booking has not been paid for."
    );
  }

  // A class must have been selected
  if (!booking.classId) {
    throw new Error(
      "Please select a class before confirming your booking."
    );
  }

  // A schedule must have been selected
  if (!booking.scheduleId) {
    throw new Error(
      "Please select a schedule before confirming your booking."
    );
  }

  // A start date must have been selected
  if (!booking.bookingDate) {
    throw new Error(
      "Please select a start date before confirming your booking."
    );
  }

  // Health & Safety form must be completed
  const healthSafetyForm =
    await prisma.healthSafetyForm.findUnique({
      where: {
        bookingId: booking.id,
      },
    });

  if (!healthSafetyForm) {
    throw new Error(
      "Please complete your Health & Safety form before confirming your booking."
    );
  }

  // Prevent confirming an already confirmed booking
  if (booking.bookingStatus === "CONFIRMED") {
    return booking;
  }

  const confirmedBooking =
    await prisma.booking.update({
      where: {
        id: booking.id,
      },

      data: {
        bookingStatus: "CONFIRMED",
      },

      include: {
        membership: true,
        schedule: true,
        healthSafetyForm: true,
      },
    });

  return confirmedBooking;
}

async saveHealthSafetyForm(
  bookingId: string,
  userId: string,
  data: HealthSafetyFormDto
) {
  // 1. Find booking
  const booking =
    await prisma.booking.findFirst({
      where: {
        id: bookingId,
        userId,
      },
    });

  if (!booking) {
    throw new Error(
      "Booking not found or does not belong to you."
    );
  }

  // 2. Check payment
  if (
    booking.paymentStatus !== PaymentStatus.PAID
  ) {
    throw new Error(
      "Health & Safety information can only be submitted for a paid booking."
    );
  }

  // 3. Create/update health form
  const healthSafetyForm =
    await prisma.healthSafetyForm.upsert({
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

        emergencyContactName:
          data.emergencyContactName || null,

        emergencyContactRelationship:
          data.emergencyContactRelationship || null,

        emergencyContactPhone:
          data.emergencyContactPhone || null,

        pregnancy:
          data.pregnancy || null,

        pregnancyWeeks:
          data.pregnancyWeeks ?? null,

        dueDate: data.dueDate
          ? new Date(data.dueDate)
          : null,

        pregnancyClearance:
          data.pregnancyClearance || null,

        postpartum:
          data.postpartum || null,

        deliveryDate: data.deliveryDate
          ? new Date(data.deliveryDate)
          : null,

        postpartumClearance:
          data.postpartumClearance || null,

        screeningAnswers:
          data.screeningAnswers || {},

        surgery:
          data.surgery || null,

        surgeryDetails:
          data.surgeryDetails || null,

        surgeryClearance:
          data.surgeryClearance || null,

        consent:
          data.consent || [],

        signature:
          data.signature || null,

   

        submittedAt: new Date(),
      },

      update: {
        dateOfBirth: data.dateOfBirth
          ? new Date(data.dateOfBirth)
          : null,

        age: data.age ?? null,

        emergencyContactName:
          data.emergencyContactName || null,

        emergencyContactRelationship:
          data.emergencyContactRelationship || null,

        emergencyContactPhone:
          data.emergencyContactPhone || null,

        pregnancy:
          data.pregnancy || null,

        pregnancyWeeks:
          data.pregnancyWeeks ?? null,

        dueDate: data.dueDate
          ? new Date(data.dueDate)
          : null,

        pregnancyClearance:
          data.pregnancyClearance || null,

        postpartum:
          data.postpartum || null,

        deliveryDate: data.deliveryDate
          ? new Date(data.deliveryDate)
          : null,

        postpartumClearance:
          data.postpartumClearance || null,

        screeningAnswers:
          data.screeningAnswers || {},

        surgery:
          data.surgery || null,

        surgeryDetails:
          data.surgeryDetails || null,

        surgeryClearance:
          data.surgeryClearance || null,

        consent:
          data.consent || [],

        signature:
          data.signature || null,


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
async updateBookingSchedule(
  bookingId: string,
  userId: string,
  scheduleId: string
) {
  // 1. Find the member's booking
  const booking = await prisma.booking.findFirst({
    where: {
      id: bookingId,
      userId,
    },
  });

  if (!booking) {
    throw new Error(
      "Booking not found or does not belong to you."
    );
  }

  // 2. Payment must be completed
  if (booking.paymentStatus !== PaymentStatus.PAID) {
    throw new Error(
      "Your membership payment has not been completed."
    );
  }

  // 3. Member must have selected a class
  if (!booking.classId) {
    throw new Error(
      "Please select a class before selecting a schedule."
    );
  }

  // 4. Find the selected schedule
  const schedule = await prisma.schedule.findFirst({
    where: {
      id: scheduleId,
      isActive: true,
    },
  });

  if (!schedule) {
    throw new Error(
      "Selected schedule was not found or is no longer available."
    );
  }

  // 5. Make sure the schedule belongs to the selected class
  if (
    schedule.className.toLowerCase() !==
    booking.classId.toLowerCase()
  ) {
    throw new Error(
      "The selected schedule does not belong to your selected class."
    );
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
async updateBookingStartDate(
  bookingId: string,
  userId: string,
  startDate: string
) {
  // 1. Find the member's booking
  const booking = await prisma.booking.findFirst({
    where: {
      id: bookingId,
      userId,
    },
    include: {
      schedule: true,
    },
  });

  if (!booking) {
    throw new Error(
      "Booking not found or does not belong to you."
    );
  }

  // 2. Payment must be completed
  if (booking.paymentStatus !== PaymentStatus.PAID) {
    throw new Error(
      "Your membership payment has not been completed."
    );
  }

  // 3. A schedule must be selected first
  if (!booking.schedule) {
    throw new Error(
      "Please select a schedule before choosing your start date."
    );
  }

  // 4. Parse the date
  const selectedDate = new Date(startDate);

  if (Number.isNaN(selectedDate.getTime())) {
    throw new Error(
      "Invalid start date."
    );
  }

  // 5. Prevent selecting a date in the past
  const today = new Date();

  today.setHours(0, 0, 0, 0);

  const dateToCompare = new Date(selectedDate);

  dateToCompare.setHours(0, 0, 0, 0);

  if (dateToCompare < today) {
    throw new Error(
      "Start date cannot be in the past."
    );
  }

  // 6. Make sure the date matches the schedule's day
  const dayNames = [
    "SUNDAY",
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
  ];

  const selectedDay =
    dayNames[selectedDate.getDay()];

  if (
    selectedDay !==
    booking.schedule.dayOfWeek
  ) {
    throw new Error(
      `Your selected schedule is on ${booking.schedule.dayOfWeek}. Please choose a ${booking.schedule.dayOfWeek.toLowerCase()} start date.`
    );
  }

  // 7. Save the actual booking date
  const updatedBooking =
    await prisma.booking.update({
      where: {
        id: booking.id,
      },
      data: {
        bookingDate: selectedDate,
      },
      include: {
        membership: true,
        schedule: true,
      },
    });

  return updatedBooking;
}
}

export default new BookingService();