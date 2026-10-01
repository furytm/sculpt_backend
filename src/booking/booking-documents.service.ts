import  prisma  from "../config/prisma.js";
import {
  BookingStatus,
  PaymentStatus,
} from "@prisma/client";
import { bookingPdfService } from "./booking-pdf.service.js";




export class BookingDocumentsService {
async getBookingVoucher(
  bookingId: string,
  userId?: string
) {
  const booking =
    await prisma.booking.findUnique({
      where: {
        id: bookingId,
      },

      include: {
        membership: true,

        user: true,

      session: {
  include: {
    schedule: true,
  },
},
      },
    });

  if (!booking) {
    throw new Error("Booking not found.");
  }

  if (
    userId &&
    booking.userId !== userId
  ) {
    throw new Error(
      "You are not authorized to access this voucher."
    );
  }

  if (
    booking.bookingStatus !==
    BookingStatus.CONFIRMED
  ) {
    throw new Error(
      "Booking must be confirmed before a voucher can be downloaded."
    );
  }

if (!booking.session) {
    throw new Error(
      "No class session is attached to this booking."
    );
  }
const session = booking.session;
  const pdf =
    await bookingPdfService.generateVoucher({
  fullName: booking.fullName ?? "Sculpt LAB Member",
email: booking.email ?? "Not provided",

      bookingReference:
        booking.paymentReference,

      className:
        session.schedule.className,

      instructor:
        session.schedule.tutorName,

      sessionDate:
        session.sessionDate,

      startTime:
        session.schedule.startTime,

      endTime:
        session.schedule.endTime,

      membershipName:
        booking.membership.name,

      bookingStatus:
        booking.bookingStatus,
    });

  return {
    filename:
      `sculpt-lab-booking-voucher-${booking.paymentReference}.pdf`,

    pdf,
  };
}

async getBookingReceipt(
  bookingId: string,
  userId?: string
) {
  const booking =
    await prisma.booking.findUnique({
      where: {
        id: bookingId,
      },

      include: {
        membership: true,
        user: true,
      },
    });

  if (!booking) {
    throw new Error("Booking not found.");
  }

  if (
    userId &&
    booking.userId !== userId
  ) {
    throw new Error(
      "You are not authorized to access this receipt."
    );
  }

  if (
    booking.paymentStatus !==
    PaymentStatus.PAID
  ) {
    throw new Error(
      "Payment has not been completed."
    );
  }

  const pdf =
    await bookingPdfService.generateReceipt({
  fullName: booking.fullName ?? "Sculpt LAB Member",
email: booking.email ?? "Not provided",

      reference:
        booking.paymentReference,

      amount:
        booking.amount,

      paymentDate:
        booking.updatedAt,

      paymentMethod:
        booking.paymentMethod,

      item:
        booking.membership.name,

      paymentStatus:
        booking.paymentStatus,
    });

  return {
    filename:
      `sculpt-lab-payment-receipt-${booking.paymentReference}.pdf`,

    pdf,
  };
}
async getGuestPaymentReceipt(reference: string) {
  const booking = await prisma.booking.findUnique({
    where: {
      paymentReference: reference,
    },
    include: {
      membership: true,
      user: true,
    },
  });

  if (!booking) {
    throw new Error("Booking not found.");
  }

  if (booking.paymentReference !== reference) {
    throw new Error("Invalid payment reference.");
  }

  if (booking.paymentStatus !== PaymentStatus.PAID) {
    throw new Error("Payment has not been completed.");
  }

  const pdf = await bookingPdfService.generateReceipt({
    fullName: booking.fullName ?? "Sculpt LAB Member",
    email: booking.email ?? "Not provided",
    reference: booking.paymentReference,
    amount: booking.amount,
    paymentDate: booking.updatedAt,
    paymentMethod: booking.paymentMethod,
    item: booking.membership?.name ?? "Sculpt LAB Membership",
    paymentStatus: booking.paymentStatus,
  });

  return {
    filename: `sculpt-lab-payment-receipt-${booking.paymentReference}.pdf`,
    pdf,
  };
}
}

export const bookingDocumentsService =
  new BookingDocumentsService();