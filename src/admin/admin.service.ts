import {
  BookingStatus,
  PaymentMethod,
  PaymentStatus,
  UserRole,MembershipStatus,
} from "@prisma/client";
import prisma from "../config/prisma.js";

import { membershipActivationService } from "../membership-activation/membership-activation.service.js";

console.log(
  "🔥 ACTIVATION SERVICE IMPORT:",
  membershipActivationService
);
class AdminService {
  async getPendingOfflinePayments() {
    return prisma.booking.findMany({
      where: {
        paymentMethod: PaymentMethod.OFFLINE,
        paymentStatus: PaymentStatus.PENDING,
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
        user: true,
      },

      orderBy: {
        createdAt: "desc",
      },
    });
  }
async getDashboard() {
  const [
    totalMembers,
    activeMemberships,
    pendingBookings,
    confirmedBookings,
    paidBookings,
    pendingPayments,
    offlinePayments,
    recentBookings,
    upcomingSchedule,
  ] = await Promise.all([
    // Total registered members
    prisma.user.count({
      where: {
        role: UserRole.MEMBER,
      },
    }),

    // Active member memberships
    prisma.memberMembership.count({
      where: {
        status: MembershipStatus.ACTIVE,
      },
    }),

    // Pending bookings
    prisma.booking.count({
      where: {
        bookingStatus: BookingStatus.PENDING,
      },
    }),

    // Confirmed bookings
    prisma.booking.count({
      where: {
        bookingStatus: BookingStatus.CONFIRMED,
      },
    }),

    // Paid bookings
    prisma.booking.count({
      where: {
        paymentStatus: PaymentStatus.PAID,
      },
    }),

    // Payments still awaiting payment
    prisma.booking.count({
      where: {
        paymentStatus: PaymentStatus.PENDING,
      },
    }),

    // All offline-payment bookings
    prisma.booking.count({
      where: {
        paymentMethod: PaymentMethod.OFFLINE,
      },
    }),

    // Latest 5 bookings
    prisma.booking.findMany({
      take: 5,
      orderBy: {
        createdAt: "desc",
      },
      include: {
        membership: true,
        user: true,
        schedule: true,
      },
    }),

    // Active schedules.
    // Schedule has no actual calendar date in your schema,
    // so these are the currently active schedules.
    prisma.schedule.findMany({
      where: {
        isActive: true,
      },
      include: {
        _count: {
          select: {
            bookings: true,
          },
        },
      },
    }),
  ]);

  // Prisma enum ordering is alphabetical, so sort the days manually.
  const dayOrder: Record<string, number> = {
    MONDAY: 1,
    TUESDAY: 2,
    WEDNESDAY: 3,
    THURSDAY: 4,
    FRIDAY: 5,
    SATURDAY: 6,
    SUNDAY: 7,
  };

  upcomingSchedule.sort((a, b) => {
    const dayDifference =
      dayOrder[a.dayOfWeek] - dayOrder[b.dayOfWeek];

    if (dayDifference !== 0) {
      return dayDifference;
    }

    return a.startTime.localeCompare(b.startTime);
  });

  return {
    stats: {
      totalMembers,
      activeMemberships,
      pendingBookings,
      confirmedBookings,
      paidBookings,
      pendingPayments,
      offlinePayments,
    },

    recentBookings,

    upcomingSchedule: upcomingSchedule.slice(0, 10),
  };
}
async confirmOfflinePayment(bookingId: string) {
  const booking = await prisma.booking.findUnique({
    where: {
      id: bookingId,
    },
    include: {
      membership: true,
      memberMembership: true,
      user: true,
      membershipActivation: true,
    },
  });

  if (!booking) {
    throw new Error("Booking not found.");
  }

  if (booking.paymentMethod !== PaymentMethod.OFFLINE) {
    throw new Error("This booking is not an offline payment.");
  }

  if (booking.paymentStatus === PaymentStatus.PAID) {
    throw new Error("This payment has already been confirmed.");
  }

  if (booking.paymentStatus !== PaymentStatus.PENDING) {
    throw new Error("Only pending payments can be confirmed.");
  }

  await prisma.booking.update({
    where: {
      id: booking.id,
    },
    data: {
      paymentStatus: PaymentStatus.PAID,
    },
  });

  try {
    const activation =
      await membershipActivationService.createActivationForBooking(
        booking.id
      );

    return activation;
  } catch (error) {
    // If membership/activation/email fails,
    // don't leave the payment incorrectly marked as PAID.
    await prisma.booking.update({
      where: {
        id: booking.id,
      },
      data: {
        paymentStatus: PaymentStatus.PENDING,
      },
    });

    throw error;
  }
}

async getPaymentDetails(bookingId: string) {
  const booking = await prisma.booking.findUnique({
    where: {
      id: bookingId,
    },
    include: {
      membership: true,
      user: true,
      memberMembership: true,
      membershipActivation: true,
      schedule: true,
      memberSchedules: {
        include: {
          schedule: true,
        },
      },
      healthSafetyForm: true,
    },
  });

  if (!booking) {
    throw new Error("Payment not found.");
  }

  return booking;
}
async rejectOfflinePayment(
  bookingId: string,
  reason?: string
) {
  const booking = await prisma.booking.findUnique({
    where: {
      id: bookingId,
    },
  });

  if (!booking) {
    throw new Error("Booking not found.");
  }

  if (booking.paymentMethod !== PaymentMethod.OFFLINE) {
    throw new Error("This booking is not an offline payment.");
  }

  if (booking.paymentStatus === PaymentStatus.PAID) {
    throw new Error(
      "A paid payment cannot be rejected."
    );
  }

  if (booking.paymentStatus !== PaymentStatus.PENDING) {
    throw new Error(
      "Only pending payments can be rejected."
    );
  }

  const updatedBooking = await prisma.booking.update({
    where: {
      id: booking.id,
    },
    data: {
      paymentStatus: PaymentStatus.FAILED,
    },
    include: {
      membership: true,
      user: true,
    },
  });

  return {
    booking: updatedBooking,
    reason:
      reason ||
      "Offline payment was not confirmed.",
  };
}
}

export const adminService = new AdminService();