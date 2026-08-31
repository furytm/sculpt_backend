import prisma from "../config/prisma.js";
import paymentService from "../payment/payment.service.js";
import {
  BookingResponse,
  CreateBookingDto,
  PaymentStatus,UpdateBookingPreferencesDto,HealthSafetyFormDto
} from "./booking.types.js";


class BookingService {
  async createBooking(
    data: CreateBookingDto
  ): Promise<BookingResponse> {
    const paymentReference = `SL-${Date.now()}`;

    const membership =
      await prisma.membership.findUnique({
        where: {
          id: data.membershipId,
        },
      });

    if (!membership) {
      throw new Error("Membership not found.");
    }

    const booking =
      await prisma.booking.create({
        data: {
          fullName: data.fullName,
          email: data.email,
          phone: data.phone,

          classId: data.classId,
          scheduleId:
            data.scheduleId ?? null,
          bookingDate:
            data.bookingDate ?? null,

          membership: {
            connect: {
              id: membership.id,
            },
          },

          amount: membership.price,

          paymentReference,
          paymentStatus:
            PaymentStatus.PENDING,
        },
      });

    const payment =
      await paymentService.initializeTransaction({
        email: booking.email,
        amount: booking.amount,
        reference: paymentReference,
      });

    return {
      booking,
      authorizationUrl:
        payment.data.authorization_url,
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
      },
      orderBy: {
        createdAt: "desc",
      },
    });
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
}

export default new BookingService();