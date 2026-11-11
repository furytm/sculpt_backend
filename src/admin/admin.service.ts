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
import bookingService from "../booking/booking.service.js";
import { adminNotificationService } from "./admin-notification.service.js";

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

  const hasSelectedClass = Boolean(booking.sessionId);

  // Payment already confirmed: a duplicate confirmation, or a retry
  // after the selected class could not be confirmed.
  if (booking.paymentStatus === PaymentStatus.PAID) {
    const classStillToConfirm =
      hasSelectedClass &&
      booking.bookingStatus === BookingStatus.PENDING;

    if (classStillToConfirm && booking.membershipActivation) {
      // Once another booking has started the membership, confirming
      // this class would move its validity to this class's date.
      if (booking.memberMembership?.startDate) {
        throw new Error(
          "The membership has already started from another booking. Book this class through the member's normal booking instead."
        );
      }

      // Retry only the class. The membership and activation already
      // exist and are not created (or emailed) again.
      return {
        bookingId: booking.id,
        paymentReference: booking.paymentReference,
        paymentConfirmed: true,
        retried: true,
        classBooking: await this.confirmSelectedOfflineClass(booking.id),
      };
    }

    if (classStillToConfirm) {
      // Another request has claimed the payment and is still creating
      // the membership.
      throw new Error(
        "This payment is already being confirmed. Please refresh in a moment."
      );
    }

    throw new Error("This payment has already been confirmed.");
  }

  if (booking.paymentStatus !== PaymentStatus.PENDING) {
    throw new Error("Only pending payments can be confirmed.");
  }

  // Claim the confirmation atomically: of two simultaneous requests,
  // only one moves the payment from PENDING to PAID and creates the
  // membership.
  //
  // Without a selected class the booking is confirmed now, as before.
  // With one, it stays PENDING until the class itself is confirmed
  // below, through the normal booking confirmation.
  const claimed = await prisma.booking.updateMany({
    where: {
      id: booking.id,
      paymentStatus: PaymentStatus.PENDING,
    },
    data: {
      paymentStatus: PaymentStatus.PAID,
      ...(hasSelectedClass
        ? {}
        : { bookingStatus: BookingStatus.CONFIRMED }),
    },
  });

  if (claimed.count !== 1) {
    throw new Error("This payment has already been confirmed.");
  }

  let activation: Awaited<
    ReturnType<typeof membershipActivationService.createActivationForBooking>
  >;

  try {
    activation =
      await membershipActivationService.createActivationForBooking(
        booking.id
      );
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

  if (!hasSelectedClass) {
    return activation;
  }

  return {
    ...activation,
    paymentConfirmed: true,
    classBooking: await this.confirmSelectedOfflineClass(booking.id),
  };
}

/**
 * Confirm the class an offline customer selected at checkout, through
 * the normal booking confirmation (BookingService), after their payment
 * is confirmed and their membership exists. That confirmation checks the
 * session, capacity, two-hour cutoff and health declaration, uses one
 * credit from the new membership, starts its validity on the class date,
 * and creates the calendar event, all in its own transaction.
 *
 * If it fails, nothing is confirmed or charged. The payment stays
 * recorded as PAID and the membership keeps all its credits, waiting for
 * its first booked class. The admin gets a result explaining what
 * happened, plus one notification (keyed by booking, so retries don't
 * repeat it), and can retry, arrange another session, or refund.
 */
private async confirmSelectedOfflineClass(bookingId: string) {
  try {
    const confirmed =
      await bookingService.confirmOfflinePaidBooking(bookingId);

    return {
      status: "CONFIRMED" as const,
      bookingId,
      sessionId: confirmed.sessionId,
      memberMembershipId: confirmed.memberMembershipId,
    };
  } catch (error) {
    const reason =
      error instanceof Error
        ? error.message
        : "The selected class could not be confirmed.";

    console.error(
      "[OFFLINE PAYMENT] Payment confirmed, but the selected class could not be confirmed:",
      bookingId,
      reason
    );

    try {
      await adminNotificationService.createForAllAdmins({
        eventKey: `offline-class-not-confirmed:${bookingId}`,
        type: "BOOKING",
        title: "Paid offline booking needs attention",
        message: `The offline payment was confirmed and the membership created, but the selected class could not be booked: ${reason}`,
        data: { bookingId, reason },
      });
    } catch (notificationError) {
      console.error(
        "[OFFLINE PAYMENT] Admin notification failed:",
        bookingId,
        notificationError
      );
    }

    return {
      status: "NOT_CONFIRMED" as const,
      bookingId,
      reason,
      resolution:
        "The payment is recorded and the membership is active with all its credits, waiting for its first booked class. Retry this confirmation once the problem is fixed, have the member book another session, or refund the payment.",
    };
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
    // Keep only memberships that are currently active and not expired.
    const eligibleMemberships = user.memberships.filter((item) => {
      const isActive =
        item.status === MembershipStatus.ACTIVE &&
        (!item.expiryDate || item.expiryDate > now);

      return isActive;
    });

    // Credits are pooled independently by membership type.
    // The underlying MemberMembership records remain separate.
    const buildCreditPool = (type: "GROUP" | "PRIVATE") => {
      const rows = eligibleMemberships.filter(
        (item) => item.membership.type === type,
      );

      if (rows.length === 0) {
        return {
          membershipType: type,
          hasMembership: false,
          isUnlimited: false,
          creditsTotal: 0,
          creditsUsed: 0,
          creditsRemaining: 0,
          expiryDate: null as Date | null,
          membershipIds: [] as string[],
        };
      }

      const isUnlimited = rows.some(
        (item) => item.creditsTotal === null,
      );

      const creditsTotal = isUnlimited
        ? null
        : rows.reduce(
            (total, item) => total + (item.creditsTotal ?? 0),
            0,
          );

      const creditsUsed = rows.reduce(
        (total, item) => total + item.creditsUsed,
        0,
      );

      // Sum each row's remaining credits independently so an overused
      // row cannot be offset by unused credits in another row.
      const creditsRemaining = isUnlimited
        ? null
        : rows.reduce(
            (total, item) =>
              total +
              Math.max(
                (item.creditsTotal ?? 0) - item.creditsUsed,
                0,
              ),
            0,
          );

      const expiryDates = rows
        .map((item) => item.expiryDate)
        .filter((date): date is Date => date !== null);

      return {
        membershipType: type,
        hasMembership: true,
        isUnlimited,
        creditsTotal,
        creditsUsed,
        creditsRemaining,
        expiryDate:
          expiryDates.length > 0
            ? new Date(
                Math.max(...expiryDates.map((date) => date.getTime())),
              )
            : null,
        membershipIds: rows.map((item) => item.id),
      };
    };

    const groupCreditPool = buildCreditPool("GROUP");
    const privateCreditPool = buildCreditPool("PRIVATE");

    // Retain the legacy single-membership fields for existing admin UI
    // consumers while exposing the authoritative type-specific pools.
    const currentMembership = eligibleMemberships[0] ?? null;

    const creditsTotal = currentMembership?.creditsTotal ?? null;
    const creditsUsed = currentMembership?.creditsUsed ?? null;
    const classLimit = currentMembership?.membership.classLimit;

    const creditsRemaining =
      !currentMembership || classLimit === null
        ? null
        : creditsTotal !== null && creditsUsed !== null
          ? Math.max(creditsTotal - creditsUsed, 0)
          : null;

    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      membership: currentMembership?.membership ?? null,
      membershipStatus: currentMembership
        ? currentMembership.status
        : "NO_ACTIVE_MEMBERSHIP",
      membershipNumber:
        currentMembership?.membershipNumber ??
        currentMembership?.activation?.membershipNumber ??
        null,
      expiryDate: currentMembership?.expiryDate ?? null,
      createdAt: currentMembership?.createdAt ?? user.createdAt,

      // Legacy fields retained for backward compatibility.
      creditsTotal,
      creditsUsed,
      creditsRemaining,

      // New pooled balances, separated by class type.
      creditPools: {
        GROUP: groupCreditPool,
        PRIVATE: privateCreditPool,
      },
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
          ? Math.max(creditsTotal - creditsUsed, 0)
          : null;

    const membershipType = member.membership.type;
    const offlinePool = {
      membershipType,
      hasMembership: true,
      isUnlimited: creditsTotal === null,
      creditsTotal,
      creditsUsed,
      creditsRemaining,
      expiryDate: member.expiryDate,
      membershipIds: [member.id],
    };

    offlineMembers.push({
      id: member.id,
      fullName: booking.fullName,
      email: booking.email,
      phone: booking.phone,
      membership: member.membership,
      membershipStatus: member.status,
      membershipNumber:
        member.membershipNumber ??
        member.activation?.membershipNumber ??
        null,
      expiryDate: member.expiryDate,
      createdAt: booking.createdAt,

      creditsTotal,
      creditsUsed,
      creditsRemaining,

      // Offline records have one underlying membership row.
      creditPools: {
        GROUP:
          membershipType === "GROUP"
            ? offlinePool
            : {
                membershipType: "GROUP",
                hasMembership: false,
                isUnlimited: false,
                creditsTotal: 0,
                creditsUsed: 0,
                creditsRemaining: 0,
                expiryDate: null,
                membershipIds: [],
              },
        PRIVATE:
          membershipType === "PRIVATE"
            ? offlinePool
            : {
                membershipType: "PRIVATE",
                hasMembership: false,
                isUnlimited: false,
                creditsTotal: 0,
                creditsUsed: 0,
                creditsRemaining: 0,
                expiryDate: null,
                membershipIds: [],
              },
      },
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


async getTutorSchedule(startDate: string, endDate: string) {
  const parseDate = (value: string): Date => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new Error("Dates must use YYYY-MM-DD format.");
    }

    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));

    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      throw new Error("Invalid calendar date.");
    }

    return date;
  };

  const start = parseDate(startDate);
  const end = parseDate(endDate);

  if (start.getTime() > end.getTime()) {
    throw new Error("startDate cannot be after endDate.");
  }

  // ClassSession.sessionDate is stored as Lagos class time
  // represented in UTC (Lagos is UTC+1).
  // Convert the requested Lagos date range to UTC boundaries.
  const startUtc = new Date(start.getTime() - 60 * 60 * 1000);

  const endExclusiveUtc = new Date(
    end.getTime() + 24 * 60 * 60 * 1000 - 60 * 60 * 1000
  );

  const bookings = await prisma.booking.findMany({
    where: {
      sessionId: {
        not: null,
      },
      session: {
        is: {
          sessionDate: {
            gte: startUtc,
            lt: endExclusiveUtc,
          },
        },
      },
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
      schedule: true,
      session: {
        include: {
          schedule: true,
        },
      },
    },
    orderBy: [
      {
        session: {
          sessionDate: "asc",
        },
      },
      {
        createdAt: "asc",
      },
    ],
  });

  return bookings.map((booking) => {
    const schedule = booking.session?.schedule ?? booking.schedule;
    const sessionDate = booking.session?.sessionDate;

    return {
      bookingId: booking.id,
      bookingStatus: booking.bookingStatus,
      paymentStatus: booking.paymentStatus,
      paymentMethod: booking.paymentMethod,

      session: {
        id: booking.session?.id ?? null,
        date: sessionDate
          ? new Date(
              sessionDate.getTime() + 60 * 60 * 1000
            ).toISOString().slice(0, 10)
          : null,
        startTime: schedule?.startTime ?? null,
        endTime: schedule?.endTime ?? null,
        sessionStatus: booking.session?.status ?? null,
      },

      class: schedule?.className ?? null,
      tutor: schedule?.tutorName ?? null,

      customer: {
        id: booking.user?.id ?? booking.userId,
        name: booking.user?.fullName ?? booking.fullName,
        email: booking.user?.email ?? booking.email,
        phone: booking.user?.phone ?? booking.phone,
      },
    };
  });
}

async getPendingOfflineMembershipPurchases() {
  return prisma.membershipPurchase.findMany({
    where: {
      paymentMethod: PaymentMethod.OFFLINE,
      paymentStatus: PaymentStatus.PENDING,
      type: "NEW",
    },
    include: {
      membership: true,
      user: {
        select: {
          id: true,
          fullName: true,
          email: true,
        },
      },
      firstSession: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });
}

async confirmOfflineMembershipPurchase(
  purchaseId: string
) {
  const purchase =
    await prisma.membershipPurchase.findUnique({
      where: {
        id: purchaseId,
      },
      include: {
        membership: true,
        memberMembership: true,
        membershipActivation: true,
      },
    });

  if (!purchase) {
    throw new Error("Membership purchase not found.");
  }

  if (purchase.paymentMethod !== PaymentMethod.OFFLINE) {
    throw new Error(
      "This purchase is not an offline payment."
    );
  }

  if (purchase.paymentStatus !== PaymentStatus.PENDING) {
    throw new Error(
      "Only pending offline purchases can be confirmed."
    );
  }

  // The admin has verified the actual bank transfer. Only one of two
  // simultaneous confirmations moves it from PENDING to PAID, so a
  // double click can't create two activations.
  const claimed = await prisma.membershipPurchase.updateMany({
    where: {
      id: purchase.id,
      paymentStatus: PaymentStatus.PENDING,
    },
    data: {
      paymentStatus: PaymentStatus.PAID,
    },
  });

  if (claimed.count !== 1) {
    throw new Error(
      "Only pending offline purchases can be confirmed."
    );
  }

  try {
    // The first class is attempted after the activation and reported
    // separately: a class that can't be booked never undoes the
    // payment or stops the activation email.
    const activation =
      await membershipActivationService
        .createActivationForPurchase(purchase.id);

    const firstClass = activation.firstClass;

    return {
      purchaseId: purchase.id,
      paymentReference: purchase.paymentReference,
      paymentStatus: PaymentStatus.PAID,
      activation,
      summary: {
        payment: PaymentStatus.PAID,
        membershipActivation: activation.activationStatus,
        activationEmail: activation.activationEmail,
        firstClass: firstClass.status,
        firstClassFailureReason:
          firstClass.status === "NOT_CONFIRMED" ? firstClass.reason : null,
        retryAvailable:
          firstClass.status === "NOT_CONFIRMED" && firstClass.retryAvailable,
      },
    };
  } catch (error) {
    // Do not silently revert a payment that the admin
    // has already verified in the bank account.
    console.error(
      "Offline membership activation failed:",
      error
    );

    throw new Error(
      "Payment was confirmed, but membership activation failed. Please retry activation or resend the registration email."
    );
  }
}

/**
 * Retry the selected first class of an already-paid, activated offline
 * membership purchase. Never confirms or charges the payment again.
 */
async retryOfflineMembershipFirstBooking(purchaseId: string) {
  return membershipActivationService.retryFirstClassBooking(purchaseId);
}

async rejectOfflineMembershipPurchase(
  purchaseId: string,
  reason?: string
) {
  const purchase =
    await prisma.membershipPurchase.findUnique({
      where: {
        id: purchaseId,
      },
    });

  if (!purchase) {
    throw new Error("Membership purchase not found.");
  }

  if (purchase.paymentMethod !== PaymentMethod.OFFLINE) {
    throw new Error(
      "This purchase is not an offline payment."
    );
  }

  if (purchase.paymentStatus !== PaymentStatus.PENDING) {
    throw new Error(
      "Only pending offline purchases can be rejected."
    );
  }

  return prisma.membershipPurchase.update({
    where: {
      id: purchaseId,
    },
    data: {
      paymentStatus: PaymentStatus.FAILED,
      paymentRejectionReason:
        reason?.trim() ||
        "Bank transfer could not be verified.",
    },
  });
}

async getAllMembershipPurchases() {
  return prisma.membershipPurchase.findMany({
    where: {
      paymentMethod: PaymentMethod.OFFLINE,
      type: "NEW",
    },
    include: {
      membership: true,
      user: {
        select: {
          id: true,
          fullName: true,
          email: true,
        },
      },
      firstSession: {
        include: {
          schedule: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}
async addMembershipToMember(data: {
  memberId: string;
  membershipId: string;
  totalCredits?: number;
  usedCredits?: number;
  startDate?: string;
}) {
  return membershipActivationService
    .createManualMembershipForRegisteredUser({
      userId: data.memberId,
      membershipId: data.membershipId,
      totalCredits: data.totalCredits,
      usedCredits: data.usedCredits,
      startDate: data.startDate,
    });
}

}

export const adminService = new AdminService();