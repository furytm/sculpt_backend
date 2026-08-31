import prisma from "../config/prisma.js";
import paymentService from "../payment/payment.service.js";
import {
  BookingResponse,
  CreateBookingDto,
  PaymentStatus,UpdateBookingPreferencesDto,
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

  if (
    booking.paymentStatus !== PaymentStatus.PAID
  ) {
    throw new Error(
      "Your membership payment has not been completed."
    );
  }

  const preferredStartDate =
    new Date(data.preferredStartDate);

  if (
    Number.isNaN(
      preferredStartDate.getTime()
    )
  ) {
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
}

export default new BookingService();