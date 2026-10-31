import crypto from "crypto";
import {
  BookingStatus,
  PaymentMethod,
  PaymentStatus,
  UserRole,MembershipStatus,
} from "@prisma/client";
import prisma from "../config/prisma.js";
import {
  sendPasswordResetEmail,
  sendVerificationEmail,
  sendPaymentConfirmationEmail,
} from "../utils/mailer.js";

import { membershipActivationService } from "../membership-activation/membership-activation.service.js";
import { googleCalendarService } from "../google-calendar/google-calendar.service.js";

console.log(
  "🔥 ACTIVATION SERVICE IMPORT:",
  membershipActivationService
);

function hasSessionEnded(sessionDate: Date, endTime: string): boolean {
  // Sculpt LAB operates in Nigeria (WAT = UTC+1).
  const date = new Date(sessionDate).toISOString().slice(0, 10);

  const endDateTime = new Date(
    `${date}T${endTime}:00+01:00`,
  );

  return endDateTime.getTime() <= Date.now();
}
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
    membersList,
    activeMemberships,
    pendingBookings,
    confirmedBookings,
    paidBookings,
    pendingPayments,
    offlinePayments,
    recentBookings,
    upcomingSchedule,
  ] = await Promise.all([
    // TOTAL MEMBERS
    // Includes registered members and eligible offline customers.
    this.getAllMembers(),

    // ACTIVE MEMBERSHIPS
    prisma.memberMembership.count({
      where: {
        status: MembershipStatus.ACTIVE,
      },
    }),

    // PENDING BOOKINGS
    prisma.booking.count({
      where: {
        bookingStatus: BookingStatus.PENDING,
      },
    }),

    // CONFIRMED BOOKINGS
    prisma.booking.count({
      where: {
        bookingStatus: BookingStatus.CONFIRMED,
      },
    }),

    // PAID BOOKINGS
    prisma.booking.count({
      where: {
        paymentStatus: PaymentStatus.PAID,
      },
    }),

    // PENDING PAYMENTS
    prisma.booking.count({
      where: {
        paymentStatus: PaymentStatus.PENDING,
      },
    }),

    // OFFLINE PAYMENTS
    prisma.booking.count({
      where: {
        paymentMethod: PaymentMethod.OFFLINE,
      },
    }),

    // RECENT BOOKINGS
    prisma.booking.findMany({
      take: 5,
      orderBy: {
        createdAt: 'desc',
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
            createdAt: 'asc',
          },
        },
      },
    }),

    // UPCOMING / ACTIVE SCHEDULES
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
          dayOfWeek: 'asc',
        },
        {
          startTime: 'asc',
        },
      ],
    }),
  ]);


//   console.log("DASHBOARD DEBUG:", {
//   membersListLength: membersList.length,
//   sampleMembers: membersList.slice(0, 3).map((member) => ({
//     id: member.id,
//     fullName: member.fullName,
//     email: member.email,
//     membershipStatus: member.membershipStatus,
//   })),
// });

  // Calculate unique customers returned by getAllMembers().
  const totalMembers = membersList.length;

  // WEEKDAY ORDER
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

  // RETURN DASHBOARD DATA
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



async resendRegistrationEmail(email: string) {
  const normalizedEmail = email.trim().toLowerCase();

  // First, try to resend an offline membership activation email.
  const activation =
    await membershipActivationService.resendActivationForEmail(
      normalizedEmail
    );

  if (activation.found) {
    if (!activation.emailSent) {
      throw new Error("Failed to send membership activation email.");
    }

    return {
      success: true,
      message: "Membership activation email resent successfully.",
    };
  }

  // Preserve the existing online booking email flow.
  const frontendUrl = process.env.FRONTEND_URL?.replace(/\/+$/, "");

  if (!frontendUrl) {
    throw new Error("FRONTEND_URL is not configured.");
  }

  const booking = await prisma.booking.findFirst({
    where: {
      email: {
        equals: normalizedEmail,
        mode: "insensitive",
      },
      paymentStatus: PaymentStatus.PAID,
      paymentMethod: { not: "OFFLINE" },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const bookingReference = booking?.paymentReference ?? "";

  try {
    await sendPaymentConfirmationEmail({
      email: normalizedEmail,
      fullName: booking?.fullName || "Sculpt LAB customer",
      bookingReference,
      registrationUrl: bookingReference
        ? `${frontendUrl}/register?reference=${encodeURIComponent(bookingReference)}`
        : `${frontendUrl}/register`,
      loginUrl: bookingReference
        ? `${frontendUrl}/login?reference=${encodeURIComponent(bookingReference)}`
        : `${frontendUrl}/login`,
    });

    return {
      success: true,
      message: "Registration email sent successfully.",
    };
  } catch (error) {
    console.error(
      "Failed to resend registration email:",
      normalizedEmail,
      error
    );

    throw new Error("Unable to send registration email.");
  }
}



  /**
   * Get one booking for admin management.
   */
  async getBookingById(bookingId: string) {
    const booking = await prisma.booking.findUnique({
      where: {
        id: bookingId,
      },

      include: {
        membership: true,

        memberMembership: true,

        user: true,

        healthSafetyForm: true,

        membershipActivation: true,

        schedule: true,

        session: {
          include: {
            schedule: true,
          },
        },

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

    if (!booking) {
      throw new Error("Booking not found.");
    }

    return booking;
  }
/**
 * Cancel a booking as an admin.
 *
 * Cancelling preserves the booking record for history,
 * restores one finite membership credit, frees the
 * session spot, and removes the Google Calendar event.
 */
async cancelBooking(bookingId: string) {
  const result = await prisma.$transaction(async (tx) => {
    /**
     * Lock the booking so two cancellation requests
     * cannot restore the same credit twice.
     */
    await tx.$queryRaw`
      SELECT id
      FROM "Booking"
      WHERE id = ${bookingId}
      FOR UPDATE
    `;

    const booking = await tx.booking.findUnique({
      where: {
        id: bookingId,
      },

      include: {
        memberMembership: true,

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

    /**
     * Only confirmed bookings should be cancelled.
     */
    if (booking.bookingStatus !== BookingStatus.CONFIRMED) {
      throw new Error(
        "Only confirmed bookings can be cancelled."
      );
    }

    /**
     * A group booking must have an associated session.
     */
    if (!booking.session) {
      throw new Error(
        "This booking does not have an associated class session."
      );
    }

    /**
     * Do not allow an admin to cancel a booking
     * after the class has already started.
     */
    if (booking.session.sessionDate <= new Date()) {
      throw new Error(
        "This booking can no longer be cancelled because the session has started or already passed."
      );
    }

    /**
     * Cancel the booking.
     */
    const cancelledBooking = await tx.booking.update({
      where: {
        id: booking.id,
      },

      data: {
        bookingStatus: BookingStatus.CANCELLED,
      },

      include: {
        membership: true,
        memberMembership: true,
        user: true,
        session: {
          include: {
            schedule: true,
          },
        },
      },
    });

    /**
     * Restore one credit for finite memberships.
     *
     * Unlimited memberships have creditsTotal === null,
     * so nothing is restored.
     */
    let creditRestored = false;

    if (
      booking.memberMembership &&
      booking.memberMembership.creditsTotal !== null &&
      booking.memberMembership.creditsUsed > 0
    ) {
      await tx.memberMembership.update({
        where: {
          id: booking.memberMembership.id,
        },

        data: {
          creditsUsed: {
            decrement: 1,
          },
        },
      });

      creditRestored = true;
    }

    /**
     * Recalculate the number of confirmed bookings.
     */
    const session = booking.session;

    const confirmedBookingCount =
      await tx.booking.count({
        where: {
          sessionId: session.id,
          bookingStatus: BookingStatus.CONFIRMED,
        },
      });

    const capacity =
      session.capacity ??
      session.schedule.capacity;

    /**
     * If the session was FULL and now has space,
     * reopen it.
     */
    if (
      session.status === "FULL" &&
      confirmedBookingCount < capacity
    ) {
      await tx.classSession.update({
        where: {
          id: session.id,
        },

        data: {
          status: "OPEN",
        },
      });
    }

    return {
      booking: cancelledBooking,

      creditRestored,

      calendarEventId:
        booking.calendarEventId,

      session: {
        id: session.id,
        capacity,
        bookedCount: confirmedBookingCount,
        availableSlots: Math.max(
          capacity - confirmedBookingCount,
          0
        ),
      },

      message: "Booking cancelled successfully.",
    };
  });

  // =====================================================
  // GOOGLE CALENDAR CLEANUP
  // =====================================================

  if (result.calendarEventId) {
    try {
      await googleCalendarService.deleteBookingEvent(
        result.calendarEventId
      );

      console.log(
        `✅ Google Calendar event deleted for admin-cancelled booking ${bookingId}`
      );
    } catch (calendarError) {
      console.error(
        `⚠️ Failed to remove Google Calendar event for admin-cancelled booking ${bookingId}:`,
        calendarError
      );
    }
  }

  return result;
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


async deleteMember(memberId: string) {
  // =====================================================
  // 1. CHECK IF THIS IS A REGISTERED MEMBER
  // =====================================================

  const user = await prisma.user.findUnique({
    where: { id: memberId },
    include: {
      memberships: true,
    },
  });

  let memberType: "REGISTERED" | "OFFLINE";
  let bookings: Array<{
    id: string;
    calendarEventId: string | null;
    sessionId: string | null;
    bookingStatus: BookingStatus;
  }> = [];

  let membershipIds: string[] = [];

  if (user) {
    if (user.role !== UserRole.MEMBER) {
      throw new Error("Only member accounts can be deleted.");
    }

    memberType = "REGISTERED";

    membershipIds = user.memberships.map(
      (membership) => membership.id
    );

    // Get all bookings belonging to this member.
    bookings = await prisma.booking.findMany({
      where: {
        OR: [
          { userId: user.id },
          ...(membershipIds.length
            ? [{ memberMembershipId: { in: membershipIds } }]
            : []),
        ],
      },
      select: {
        id: true,
        calendarEventId: true,
        sessionId: true,
        bookingStatus: true,
      },
    });
  } else {
    // =====================================================
    // 2. CHECK IF THIS IS AN OFFLINE MEMBER
    // =====================================================

    const offlineMember =
      await prisma.memberMembership.findFirst({
        where: {
          id: memberId,
          userId: null,
        },
        include: {
          bookings: {
            select: {
              id: true,
              calendarEventId: true,
              sessionId: true,
              bookingStatus: true,
            },
          },
        },
      });

    if (!offlineMember) {
      throw new Error("Member not found.");
    }

    memberType = "OFFLINE";
    membershipIds = [offlineMember.id];
    bookings = offlineMember.bookings;
  }

  // =====================================================
  // 3. COLLECT BOOKING AND SESSION INFORMATION
  // =====================================================

  const bookingIds = bookings.map((booking) => booking.id);

  const calendarEventIds = bookings
    .map((booking) => booking.calendarEventId)
    .filter((id): id is string => Boolean(id));

  const sessionIds = [
    ...new Set(
      bookings
        .map((booking) => booking.sessionId)
        .filter((id): id is string => Boolean(id))
    ),
  ];

  // =====================================================
  // 4. DELETE MEMBER AND RELATED RECORDS
  // =====================================================

  await prisma.$transaction(async (tx) => {
    // Delete booking-related health and safety forms.
    if (bookingIds.length > 0) {
      await tx.healthSafetyForm.deleteMany({
        where: {
          bookingId: { in: bookingIds },
        },
      });

      // Delete schedules attached to these bookings.
      await tx.memberSchedule.deleteMany({
        where: {
          bookingId: { in: bookingIds },
        },
      });

      // Delete membership activations attached to bookings.
      await tx.membershipActivation.deleteMany({
        where: {
          bookingId: { in: bookingIds },
        },
      });

      // Delete all bookings belonging to this member.
      await tx.booking.deleteMany({
        where: {
          id: { in: bookingIds },
        },
      });
    }

    // Delete activations attached to the member's memberships.
    if (membershipIds.length > 0) {
      await tx.membershipActivation.deleteMany({
        where: {
          memberMembershipId: {
            in: membershipIds,
          },
        },
      });
    }

    if (memberType === "REGISTERED") {
      // Delete the registered member's account.
      // Related tokens, health forms and memberships
      // are handled by the configured Prisma relations.
      await tx.user.delete({
        where: {
          id: memberId,
        },
      });
    } else {
      // Delete the offline membership record.
      // Its linked membership purchase is preserved
      // because the schema uses onDelete: SetNull.
      await tx.memberMembership.delete({
        where: {
          id: memberId,
        },
      });
    }

    // ===================================================
    // 5. REOPEN FULL SESSIONS WHERE SPACES ARE AVAILABLE
    // ===================================================

    for (const sessionId of sessionIds) {
      const session = await tx.classSession.findUnique({
        where: { id: sessionId },
        include: {
          schedule: true,
        },
      });

      if (!session || session.status !== "FULL") {
        continue;
      }

      const confirmedBookings = await tx.booking.count({
        where: {
          sessionId,
          bookingStatus: BookingStatus.CONFIRMED,
        },
      });

      const capacity =
        session.capacity ?? session.schedule.capacity;

      if (confirmedBookings < capacity) {
        await tx.classSession.update({
          where: { id: sessionId },
          data: {
            status: "OPEN",
          },
        });
      }
    }
  });

  // =====================================================
  // 6. REMOVE ASSOCIATED GOOGLE CALENDAR EVENTS
  // =====================================================

  for (const calendarEventId of calendarEventIds) {
    try {
      await googleCalendarService.deleteBookingEvent(
        calendarEventId
      );
    } catch (calendarError) {
      console.error(
        "Failed to remove Google Calendar event:",
        calendarEventId,
        calendarError
      );
    }
  }

  // =====================================================
  // 7. RETURN RESULT
  // =====================================================

  return {
    success: true,
    memberId,
    memberType,
    deletedBookings: bookingIds.length,
    message: "Member deleted successfully.",
  };
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

  const calendarEventId =
    booking.calendarEventId;

  const result = await prisma.$transaction(async (tx) => {
    /**
     * Remember the booking state before deleting it.
     *
     * A CONFIRMED booking consumed a membership credit,
     * so deleting it must restore that credit.
     *
     * PENDING and CANCELLED bookings do not restore a credit.
     */
    const shouldRestoreCredit =
      booking.bookingStatus === BookingStatus.CONFIRMED &&
      booking.memberMembership !== null &&
      booking.memberMembership.creditsTotal !== null &&
      booking.memberMembership.creditsUsed > 0;

    /**
     * Remove membership activation linked to this booking.
     */
    if (booking.membershipActivation) {
      await tx.membershipActivation.delete({
        where: {
          id: booking.membershipActivation.id,
        },
      });
    }

    /**
     * Remove health & safety form.
     */
    if (booking.healthSafetyForm) {
      await tx.healthSafetyForm.delete({
        where: {
          id: booking.healthSafetyForm.id,
        },
      });
    }

    /**
     * Remove member schedules linked to this booking.
     */
    if (booking.memberSchedules.length > 0) {
      await tx.memberSchedule.deleteMany({
        where: {
          bookingId: booking.id,
        },
      });
    }

    /**
     * Restore one membership credit if this booking
     * had previously consumed one.
     */
    if (shouldRestoreCredit && booking.memberMembership) {
      await tx.memberMembership.update({
        where: {
          id: booking.memberMembership.id,
        },

        data: {
          creditsUsed: {
            decrement: 1,
          },
        },
      });
    }

    /**
     * Delete the booking.
     *
     * We do NOT modify MemberMembership.bookingId because
     * MemberMembership does not have a bookingId field.
     *
     * The relationship is:
     *
     * Booking.memberMembershipId
     *        ↓
     * MemberMembership.id
     */
    await tx.booking.delete({
      where: {
        id: booking.id,
      },
    });

    /**
     * Recalculate the session after deleting the booking.
     *
     * The deleted booking is no longer occupying a spot.
     */
    let sessionAvailability = null;

    if (booking.session) {
      const confirmedBookingCount =
        await tx.booking.count({
          where: {
            sessionId: booking.session.id,
            bookingStatus: BookingStatus.CONFIRMED,
          },
        });

      const capacity =
        booking.session.capacity ??
        booking.session.schedule.capacity;

      /**
       * If the session was FULL and now has space,
       * reopen it.
       */
      if (
        booking.session.status === "FULL" &&
        confirmedBookingCount < capacity
      ) {
        await tx.classSession.update({
          where: {
            id: booking.session.id,
          },

          data: {
            status: "OPEN",
          },
        });
      }

      sessionAvailability = {
        sessionId: booking.session.id,
        capacity,
        bookedCount: confirmedBookingCount,
        availableSlots: Math.max(
          capacity - confirmedBookingCount,
          0
        ),
      };
    }

       return {
      bookingId: booking.id,
      message: "Booking deleted successfully.",
      creditRestored: shouldRestoreCredit,
      sessionAvailability,
    };
  });

  // =====================================================
  // GOOGLE CALENDAR CLEANUP
  // =====================================================

  if (calendarEventId) {
    try {
      await googleCalendarService.deleteBookingEvent(
        calendarEventId
      );

      console.log(
        `✅ Google Calendar event deleted for deleted booking ${bookingId}`
      );
    } catch (calendarError) {
      console.error(
        `⚠️ Failed to remove Google Calendar event for deleted booking ${bookingId}:`,
        calendarError
      );
    }
  }

  return result;
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

async createOfflineMember(data: {
  fullName?: string;
  email?: string;
  phone?: string;
  membershipId: string;
  remainingCredits?: number;
}) {
  const fullName = data.fullName?.trim() || null;
  const email = data.email?.trim().toLowerCase() || null;
  const phone = data.phone?.trim() || null;

  if (!data.membershipId) {
    throw new Error("Membership ID is required.");
  }

  // =====================================================
  // GET MEMBERSHIP
  // =====================================================

  const membership = await prisma.membership.findUnique({
    where: {
      id: data.membershipId,
    },
  });

  if (!membership) {
    throw new Error("Membership not found.");
  }

  if (!membership.isActive) {
    throw new Error("This membership is not active.");
  }

  
if (membership.classLimit === null) {
  if (data.remainingCredits !== undefined) {
    throw new Error(
      "Remaining credits cannot be set for an unlimited membership."
    );
  }
} else {
  const remainingCredits =
    data.remainingCredits ?? membership.classLimit;

  if (
    !Number.isInteger(remainingCredits) ||
    remainingCredits < 0 ||
    remainingCredits > membership.classLimit
  ) {
    throw new Error(
      `Remaining credits must be between 0 and ${membership.classLimit}.`
    );
  }
}

  // =====================================================
  // CREATE OFFLINE BOOKING
  // =====================================================

  const paymentReference =
    `OFFLINE-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

  const booking = await prisma.booking.create({
    data: {
      fullName,
      email,
      phone,
      membershipId: membership.id,
      amount: membership.price,
      paymentReference,
      paymentStatus: PaymentStatus.PAID,
      bookingStatus: BookingStatus.CONFIRMED,
      paymentMethod: PaymentMethod.OFFLINE,
    },
  });

  try {
    // =====================================================
    // CREATE MEMBERSHIP + ACTIVATION
    // =====================================================

const activation =
  await membershipActivationService.createActivationForBooking(
    booking.id,
    data.remainingCredits ?? membership.classLimit ?? undefined
  );

    // =====================================================
    // RETURN RESULT
    // =====================================================

    return {
      booking: {
        id: booking.id,
        paymentReference: booking.paymentReference,
        fullName: booking.fullName,
        email: booking.email,
        phone: booking.phone,
        amount: booking.amount,
        paymentStatus: booking.paymentStatus,
        bookingStatus: booking.bookingStatus,
        paymentMethod: booking.paymentMethod,
      },

      membership: {
        id: membership.id,
        name: membership.name,
        price: membership.price,
        classLimit: membership.classLimit,
        duration: membership.duration,
        type: membership.type,
      },

      activation,
    };
  } catch (error) {
    // =====================================================
    // ROLLBACK BOOKING IF ACTIVATION CREATION FAILS
    // =====================================================

    await prisma.booking.delete({
      where: {
        id: booking.id,
      },
    });

    throw error;
  }
}


async getAllMembers() {
  const now = new Date();

  // Registered members, including those with no current membership.
  const users = await prisma.user.findMany({
    where: {
      role: UserRole.MEMBER,
    },
    include: {
      memberships: {
        include: {
          membership: true,
          activation: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const registeredMembers = users.map((user) => {
 const currentMembership =
  user.memberships.find((item) => {
    const isActive =
      item.status === MembershipStatus.ACTIVE &&
      (!item.expiryDate || item.expiryDate > now);

    const hasCredits =
      item.creditsTotal === null ||
      item.creditsUsed < item.creditsTotal;

    return isActive && hasCredits;
  }) ?? null;

    const creditsTotal =
      currentMembership?.creditsTotal ?? null;

    const creditsUsed =
      currentMembership?.creditsUsed ?? null;

    const classLimit =
      currentMembership?.membership.classLimit;

    const creditsRemaining =
      !currentMembership || classLimit === null
        ? null
        : creditsTotal !== null && creditsUsed !== null
          ? creditsTotal - creditsUsed
          : null;

    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      membership: currentMembership?.membership ?? null,
 membershipStatus:
  currentMembership ? currentMembership.status : "NO_ACTIVE_MEMBERSHIP",
      membershipNumber:
        currentMembership?.activation?.membershipNumber ?? null,
      expiryDate: currentMembership?.expiryDate ?? null,
      createdAt:
        currentMembership?.createdAt ?? user.createdAt,

      creditsTotal,
      creditsUsed,
      creditsRemaining,
    };
  });

  // Offline customers without a User account.
  // Include only paid, confirmed offline bookings.
  const offlineMemberships =
    await prisma.memberMembership.findMany({
      where: {
        userId: null,
        bookings: {
          some: {
            paymentStatus: PaymentStatus.PAID,
            bookingStatus: BookingStatus.CONFIRMED,
            paymentMethod: PaymentMethod.OFFLINE,
          },
        },
      },
      include: {
        membership: true,
        activation: true,
        bookings: {
          where: {
            paymentStatus: PaymentStatus.PAID,
            bookingStatus: BookingStatus.CONFIRMED,
            paymentMethod: PaymentMethod.OFFLINE,
          },
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

  // Deduplicate by email, or phone when email is unavailable.
  const seenCustomers = new Set<string>();

  for (const member of registeredMembers) {
    const email = member.email?.trim().toLowerCase();
    const phone = member.phone?.trim();

    if (email) {
      seenCustomers.add(`email:${email}`);
    } else if (phone) {
      seenCustomers.add(`phone:${phone}`);
    }
  }

  const offlineMembers = [];

  for (const member of offlineMemberships) {
    const booking = member.bookings[0];

    if (!booking) continue;

    const email = booking.email?.trim().toLowerCase();
    const phone = booking.phone?.trim();

    const customerKey = email
      ? `email:${email}`
      : phone
        ? `phone:${phone}`
        : `membership:${member.id}`;

    if (seenCustomers.has(customerKey)) continue;

    seenCustomers.add(customerKey);

    const creditsTotal = member.creditsTotal ?? null;
    const creditsUsed = member.creditsUsed;
    const classLimit = member.membership.classLimit;

    const creditsRemaining =
      classLimit === null
        ? null
        : creditsTotal !== null
          ? creditsTotal - creditsUsed
          : null;

    offlineMembers.push({
      id: member.id,
      fullName: booking.fullName,
      email: booking.email,
      phone: booking.phone,
      membership: member.membership,
      membershipStatus: member.status,
      membershipNumber:
        member.activation?.membershipNumber ?? null,
      expiryDate: member.expiryDate,
      createdAt: booking.createdAt,

      creditsTotal,
      creditsUsed,
      creditsRemaining,
    });
  }

  return [...registeredMembers, ...offlineMembers];
}


async getMemberClasses(memberId: string) {
  // First check whether this is a registered member.
  const user = await prisma.user.findUnique({
    where: { id: memberId },
    select: {
      id: true,
      fullName: true,
      email: true,
    },
  });

  // If no registered user exists, check offline membership.
  const offlineMember = user
    ? null
    : await prisma.memberMembership.findUnique({
        where: { id: memberId },
        include: {
          bookings: {
            where: {
              paymentStatus: PaymentStatus.PAID,
              paymentMethod: PaymentMethod.OFFLINE,
              bookingStatus: BookingStatus.CONFIRMED,
            },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });

  if (!user && !offlineMember) {
    throw new Error('Member not found.');
  }

  const bookings = await prisma.booking.findMany({
    where: {
      ...(user
        ? { userId: user.id }
        : { memberMembershipId: offlineMember!.id }),
      bookingStatus: BookingStatus.CONFIRMED,
      paymentStatus: PaymentStatus.PAID,
      sessionId: { not: null },
    },
    include: {
      session: {
        include: {
          schedule: true,
        },
      },
    },
  });

const classes = bookings
  .filter((booking) => booking.session)
  .map((booking) => {
    const session = booking.session!;

    const hasEnded = hasSessionEnded(
      session.sessionDate,
      session.schedule.endTime,
    );

    return {
      bookingId: booking.id,
      sessionId: session.id,
      className: session.schedule.className,
      tutorName: session.schedule.tutorName,
      sessionDate: session.sessionDate,
      startTime: session.schedule.startTime,
      endTime: session.schedule.endTime,

      // Preserve cancellation; otherwise derive completion from end time.
      sessionStatus:
        session.status === "CANCELLED"
          ? "CANCELLED"
          : session.status === "COMPLETED" || hasEnded
            ? "COMPLETED"
            : session.status,
    };
  });
  const today = new Date();
  today.setHours(0, 0, 0, 0);

const completedClasses = classes
  .filter((item) => item.sessionStatus === "COMPLETED")
  .sort(
    (a, b) =>
      new Date(b.sessionDate).getTime() -
      new Date(a.sessionDate).getTime(),
  );

const upcomingClasses = classes
  .filter(
    (item) =>
      item.sessionStatus !== "CANCELLED" &&
      item.sessionStatus !== "COMPLETED",
  )
  .sort(
    (a, b) =>
      new Date(a.sessionDate).getTime() -
      new Date(b.sessionDate).getTime(),
  );

  return {
    member: {
      id: memberId,
      fullName: user?.fullName ?? offlineMember?.bookings[0]?.fullName ?? null,
      email: user?.email ?? offlineMember?.bookings[0]?.email ?? null,
    },
    completedClasses,
    upcomingClasses,
  };
}
}

export const adminService = new AdminService();