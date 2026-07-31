import prisma from "../config/prisma.js";
import paymentService from "../payment/payment.service.js";
import {
  BookingResponse,
  CreateBookingDto,
  PaymentStatus,
} from "./booking.types.js";

class BookingService {
  async createBooking(
    data: CreateBookingDto
  ): Promise<BookingResponse> {
    const paymentReference = `SL-${Date.now()}`;

    // Check that the selected membership exists
    const membership = await prisma.membership.findUnique({
      where: {
        id: data.membershipId,
      },
    });

    if (!membership) {
      throw new Error("Membership not found.");
    }

    // Create booking
    const booking = await prisma.booking.create({
      data: {
        fullName: data.fullName,
        email: data.email,
        phone: data.phone,

        classId: data.classId,
        scheduleId: data.scheduleId,

        bookingDate: new Date(data.bookingDate),

        membership: {
          connect: {
            id: membership.id,
          },
        },

        // Use membership price instead of a hardcoded amount
        amount: membership.price,

        paymentReference,
        paymentStatus: PaymentStatus.PENDING,
      },
    });

    // Initialize payment with Paymish
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
      },
    });
  }

  async markBookingPaid(reference: string) {
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
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async getBookingConfirmation(reference: string) {
  const booking = await prisma.booking.findUnique({
    where: {
      paymentReference: reference,
    },
    include: {
      membership: true,
    },
  });

  
  if (!booking) {
    throw new Error("Booking not found.");
  }

  return booking;
}
}

export default new BookingService();