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
    // -------------------------------------------------------
    // TOTAL MEMBERS
    // -------------------------------------------------------

    prisma.user.count({
      where: {
        role: UserRole.MEMBER,
      },
    }),

    // -------------------------------------------------------
    // ACTIVE MEMBERSHIPS
    // -------------------------------------------------------

    prisma.memberMembership.count({
      where: {
        status: MembershipStatus.ACTIVE,
      },
    }),

    // -------------------------------------------------------
    // PENDING BOOKINGS
    // -------------------------------------------------------

    prisma.booking.count({
      where: {
        bookingStatus: BookingStatus.PENDING,
      },
    }),

    // -------------------------------------------------------
    // CONFIRMED BOOKINGS
    // -------------------------------------------------------

    prisma.booking.count({
      where: {
        bookingStatus: BookingStatus.CONFIRMED,
      },
    }),

    // -------------------------------------------------------
    // PAID BOOKINGS
    // -------------------------------------------------------

    prisma.booking.count({
      where: {
        paymentStatus: PaymentStatus.PAID,
      },
    }),

    // -------------------------------------------------------
    // PENDING PAYMENTS
    // -------------------------------------------------------

    prisma.booking.count({
      where: {
        paymentStatus: PaymentStatus.PENDING,
      },
    }),

    // -------------------------------------------------------
    // OFFLINE PAYMENTS
    // -------------------------------------------------------
    //
    // This counts offline bookings specifically.
    // The admin can then click Payments to see
    // which ones are pending/paid.
    //

    prisma.booking.count({
      where: {
        paymentMethod: PaymentMethod.OFFLINE,
      },
    }),

    // -------------------------------------------------------
    // RECENT BOOKINGS
    // -------------------------------------------------------
    //
    // Get the latest 5 bookings with enough information
    // for the admin dashboard.
    //

    prisma.booking.findMany({
      take: 5,

      orderBy: {
        createdAt: "desc",
      },

      include: {
        membership: true,

        user: true,

        memberMembership: true,

        healthSafetyForm: true,

        memberSchedules: {
          where: {
            isActive: true,
          },

          include: {
            schedule: true,
          },

          orderBy: {
            createdAt: "asc",
          },
        },
      },
    }),

    // -------------------------------------------------------
    // UPCOMING / ACTIVE SCHEDULES
    // -------------------------------------------------------
    //
    // Schedule does not contain a calendar date.
    // Therefore we return the active weekly schedule.
    //

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

      orderBy: [
        {
          dayOfWeek: "asc",
        },
        {
          startTime: "asc",
        },
      ],
    }),
  ]);

  // ---------------------------------------------------------
  // WEEKDAY ORDER
  // ---------------------------------------------------------

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
      dayOrder[a.dayOfWeek] -
      dayOrder[b.dayOfWeek];

    if (dayDifference !== 0) {
      return dayDifference;
    }

    return a.startTime.localeCompare(
      b.startTime
    );
  });

  // ---------------------------------------------------------
  // RETURN DASHBOARD DATA
  // ---------------------------------------------------------

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

    upcomingSchedule:
      upcomingSchedule.slice(0, 10),
  };
}

async getAllBookings() {
  const bookings = await prisma.booking.findMany({
    orderBy: {
      createdAt: "desc",
    },

    include: {
      membership: true,

      user: true,

      memberMembership: true,

      healthSafetyForm: true,

      memberSchedules: {
        where: {
          isActive: true,
        },

        include: {
          schedule: true,
        },

        orderBy: {
          createdAt: "asc",
        },
      },
    },
  });

  return bookings;
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
    bookingStatus: BookingStatus.CONFIRMED,
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
    bookingStatus: BookingStatus.PENDING,
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
async deleteBooking(bookingId: string) {
  const booking = await prisma.booking.findUnique({
    where: {
      id: bookingId,
    },
    include: {
      memberMembership: true,
      membershipActivation: true,
      healthSafetyForm: true,
      memberSchedules: true,
    },
  });

  if (!booking) {
    throw new Error("Booking not found.");
  }

  // Delete related records first so we don't violate
  // foreign-key constraints.

  await prisma.$transaction(async (tx) => {
    // Remove membership activation linked to this booking
    if (booking.membershipActivation) {
      await tx.membershipActivation.delete({
        where: {
          id: booking.membershipActivation.id,
        },
      });
    }

    // Remove health/safety form
    if (booking.healthSafetyForm) {
      await tx.healthSafetyForm.delete({
        where: {
          id: booking.healthSafetyForm.id,
        },
      });
    }

    // Remove member schedules
    if (booking.memberSchedules.length > 0) {
      await tx.memberSchedule.deleteMany({
        where: {
          bookingId: booking.id,
        },
      });
    }

    // Disconnect the booking from MemberMembership
    // instead of deleting the actual membership.
    if (booking.memberMembership) {
      await tx.memberMembership.update({
        where: {
          id: booking.memberMembership.id,
        },
        data: {
          bookingId: null,
        },
      });
    }

    // Finally delete the booking
    await tx.booking.delete({
      where: {
        id: booking.id,
      },
    });
  });

  return {
    bookingId: booking.id,
    message: "Booking deleted successfully.",
  };
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