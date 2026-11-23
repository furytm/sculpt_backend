import prisma from "../config/prisma.js";
import crypto from "crypto";

/** A refused offline-attendee request, with its HTTP status and code. */
export class OfflineAttendeeError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "OfflineAttendeeError";
  }
}

import {
  BookingStatus,
  MembershipType,
  PaymentMethod,
  PaymentStatus,
  UserRole,
} from "@prisma/client";
import bookingService from "../booking/booking.service.js";

class AdminSessionService {


    /**
   * Convert a session's calendar date and scheduled start time
   * into the actual class start timestamp in Africa/Lagos.
   *
   * Lagos is UTC+1 and does not currently observe daylight saving.
   */
  private getSessionStartAt(
    sessionDate: Date,
    startTime: string
  ): Date {
    const match = /^(\d{1,2}):(\d{2})$/.exec(startTime);

    if (!match) {
      throw new Error(`Invalid session start time: ${startTime}`);
    }

    const hours = Number(match[1]);
    const minutes = Number(match[2]);

    if (hours > 23 || minutes > 59) {
      throw new Error(`Invalid session start time: ${startTime}`);
    }

    return new Date(
      Date.UTC(
        sessionDate.getUTCFullYear(),
        sessionDate.getUTCMonth(),
        sessionDate.getUTCDate(),
        hours - 1,
        minutes
      )
    );
  }

  /**
   * Return the start of the calendar day represented by a session date.
   * ClassSession.sessionDate is treated as a date-only value.
   */
  private getSessionDateStart(date: Date): Date {
    return new Date(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate()
      )
    );
  }
  /**
   * 
   * 
   * Get class sessions for admin management.
   *
   * By default returns upcoming sessions.
   */
  async getSessions(options?: {
    fromDate?: Date;
    toDate?: Date;
    classId?: string;
    status?: "OPEN" | "FULL" | "CANCELLED" | "COMPLETED";
  }) {
 const fromDate = this.getSessionDateStart(
  options?.fromDate ?? new Date()
);

    const sessions = await prisma.classSession.findMany({
      where: {
        sessionDate: {
          gte: fromDate,
          ...(options?.toDate
            ? {
                lte: options.toDate,
              }
            : {}),
        },

        ...(options?.status
          ? {
              status: options.status,
            }
          : {}),

        ...(options?.classId
          ? {
              schedule: {
                className: {
                  equals: options.classId,
                  mode: "insensitive",
                },
              },
            }
          : {}),
      },

      include: {
        schedule: true,

        bookings: {
          where: {
            bookingStatus: "CONFIRMED",
          },
         select: {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  bookingStatus: true,
  paymentStatus: true,
  userId: true,
  memberMembershipId: true,
  createdAt: true,
  // The catalogue plan on the booking: for offline attendees, the
  // plan/package the admin recorded they paid for (no membership).
  membershipId: true,
  amount: true,
  paymentMethod: true,
  membership: {
    select: {
      id: true,
      name: true,
      type: true,
    },
  },
},
        },

        // _count: {
        //   select: {
        //     bookings: {
        //       where: {
        //         bookingStatus: "CONFIRMED",
        //       },
        //     },
        //   },
        // },
      },

      orderBy: {
        sessionDate: "asc",
      },
    });

   
return sessions.map((session) => {
  const capacity = Math.min(
    5,
    session.capacity ?? session.schedule.capacity
  );

  const groupBookedCount = session.bookings.filter(
    (booking) => booking.membership.type === "GROUP"
  ).length;

  const privateBookedCount = session.bookings.filter(
    (booking) => booking.membership.type === "PRIVATE"
  ).length;

  const bookedCount = groupBookedCount + privateBookedCount;

  const availableSlots =
    privateBookedCount > 0
      ? 0
      : Math.max(capacity - groupBookedCount, 0);

      return {
        id: session.id,

        classId: session.schedule.className,
        className: session.schedule.className,

        tutorName: session.schedule.tutorName,
        code: session.schedule.code,

        sessionDate: session.sessionDate,

        dayOfWeek: session.schedule.dayOfWeek,
        startTime: session.schedule.startTime,
        endTime: session.schedule.endTime,

   capacity,
groupBookedCount,
privateBookedCount,
bookedCount,
availableSlots,

        status: session.status,

        isAvailable:
          session.status === "OPEN" &&
          availableSlots > 0,

        bookings: session.bookings,

        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      };
    });
  }

  /**
   * Get one session with its bookings.
   */
  async getSessionById(sessionId: string) {
    const session = await prisma.classSession.findUnique({
      where: {
        id: sessionId,
      },

      include: {
        schedule: true,

     
bookings: {
  where: {
    bookingStatus: "CONFIRMED",
  },
  orderBy: {
    createdAt: "asc",
  },
  select: {
    id: true,
    fullName: true,
    email: true,
    phone: true,
    bookingStatus: true,
    paymentStatus: true,
    userId: true,
    memberMembershipId: true,
    createdAt: true,
    // The catalogue plan on the booking (see getSessions).
    membershipId: true,
    amount: true,
    paymentMethod: true,
    membership: {
      select: {
        id: true,
        name: true,
        type: true,
      },
    },
  },
},


        // _count: {
        //   select: {
        //     bookings: {
        //       where: {
        //         bookingStatus: "CONFIRMED",
        //       },
        //     },
        //   },
        // },
      },
    });

    if (!session) {
      throw new Error("Class session not found.");
    }


const capacity = Math.min(
  5,
  session.capacity ?? session.schedule.capacity
);

const groupBookedCount = session.bookings.filter(
  (booking) => booking.membership.type === "GROUP"
).length;

const privateBookedCount = session.bookings.filter(
  (booking) => booking.membership.type === "PRIVATE"
).length;

const bookedCount = groupBookedCount + privateBookedCount;

const availableSlots =
  privateBookedCount > 0
    ? 0
    : Math.max(capacity - groupBookedCount, 0);


    return {
      id: session.id,

      classId: session.schedule.className,
      className: session.schedule.className,

      tutorName: session.schedule.tutorName,
      code: session.schedule.code,

      sessionDate: session.sessionDate,

      dayOfWeek: session.schedule.dayOfWeek,
      startTime: session.schedule.startTime,
      endTime: session.schedule.endTime,

    capacity,
groupBookedCount,
privateBookedCount,
bookedCount,
availableSlots,

      status: session.status,

      isAvailable:
        session.status === "OPEN" &&
        availableSlots > 0,

      bookings: session.bookings,

      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  
/**
 * Record a walk-in or offline-paid attendee who is NOT a registered
 * member. Booking-only: no User, MemberMembership, credits, activation
 * or membership purchase is created or touched.
 *
 * `membershipId` is a catalogue plan used only as the attendee's class
 * type and rate: Booking.membershipId is required, and every capacity
 * count reads the GROUP/PRIVATE type through it. Nothing is assigned
 * to anyone.
 *
 * Rules (checked with the session row locked, so two admins can't take
 * the last seat or add the same person twice):
 * - the session is OPEN, its schedule active, and the class has not
 *   ended (Lagos time); walk-ins can still be added up to the end;
 * - always PAID and CONFIRMED, so the attendee holds a seat;
 * - the same GROUP/PRIVATE capacity rules as member bookings;
 * - at least an email or a phone number, and the same person (email,
 *   or phone) can't be added twice to the session;
 * - an email that belongs to a registered member is refused: use the
 *   add-member action so the booking is linked to their account.
 */
async addOfflineAttendee(
  sessionId: string,
  data: {
    fullName: string;
    email?: string | null;
    phone?: string | null;
    membershipId: string;
    amount?: number;
    bookingType?: "GROUP" | "PRIVATE";
  }
) {
  const fullName = data.fullName?.trim();
  const email = data.email?.trim().toLowerCase() || null;
  const phone = data.phone?.trim() || null;
  const phoneDigits = phone ? phone.replace(/\D/g, "") : null;

  if (!fullName) {
    throw new OfflineAttendeeError(400, "VALIDATION_ERROR", "Attendee name is required.");
  }

  if (!sessionId) {
    throw new OfflineAttendeeError(400, "VALIDATION_ERROR", "Session ID is required.");
  }

  if (!data.membershipId) {
    throw new OfflineAttendeeError(400, "VALIDATION_ERROR", "Class type/rate is required.");
  }

  if (!email && !phone) {
    throw new OfflineAttendeeError(
      400,
      "VALIDATION_ERROR",
      "Enter the attendee's email or phone number."
    );
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new OfflineAttendeeError(400, "VALIDATION_ERROR", "Enter a valid email address.");
  }

  if (phone && (!phoneDigits || phoneDigits.length < 7)) {
    throw new OfflineAttendeeError(400, "VALIDATION_ERROR", "Enter a valid phone number.");
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id
      FROM "ClassSession"
      WHERE id = ${sessionId}
      FOR UPDATE
    `;

    const session = await tx.classSession.findUnique({
      where: { id: sessionId },
      include: { schedule: true },
    });

    if (!session) {
      throw new OfflineAttendeeError(404, "SESSION_NOT_FOUND", "Class session not found.");
    }

    if (session.status !== "OPEN") {
      throw new OfflineAttendeeError(409, "SESSION_NOT_OPEN", "This class session is not open.");
    }

    if (!session.schedule.isActive) {
      throw new OfflineAttendeeError(409, "SESSION_NOT_OPEN", "This class schedule is not active.");
    }

    if (this.getSessionEndAt(session.sessionDate, session.schedule.endTime) <= new Date()) {
      throw new OfflineAttendeeError(
        409,
        "SESSION_ENDED",
        "This class has already ended. Attendees can be added until the class ends."
      );
    }

    const membership = await tx.membership.findUnique({
      where: { id: data.membershipId },
    });

    if (!membership || !membership.isActive) {
      throw new OfflineAttendeeError(
        400,
        "VALIDATION_ERROR",
        "Select an active class type/rate."
      );
    }

    if (data.bookingType && data.bookingType !== membership.type) {
      throw new OfflineAttendeeError(
        400,
        "VALIDATION_ERROR",
        `The selected rate is for ${membership.type.toLowerCase()} classes, not ${data.bookingType.toLowerCase()}.`
      );
    }

    // Registered members are booked against their account instead.
    if (email) {
      const registered = await tx.user.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
        select: { id: true },
      });

      if (registered) {
        throw new OfflineAttendeeError(
          409,
          "REGISTERED_MEMBER",
          "This email belongs to a registered member. Add them as a member instead of an offline attendee."
        );
      }
    }

    const confirmed = await tx.booking.findMany({
      where: {
        sessionId,
        bookingStatus: BookingStatus.CONFIRMED,
        membership: {
          type: {
            in: [MembershipType.GROUP, MembershipType.PRIVATE],
          },
        },
      },
      select: {
        email: true,
        phone: true,
        membership: { select: { type: true } },
      },
    });

    // The same person can't hold two seats in one session.
    const duplicate = confirmed.some(
      (booking) =>
        (email && booking.email?.trim().toLowerCase() === email) ||
        (phoneDigits && booking.phone && booking.phone.replace(/\D/g, "") === phoneDigits)
    );

    if (duplicate) {
      throw new OfflineAttendeeError(
        409,
        "DUPLICATE_ATTENDEE",
        "This attendee is already booked for this session."
      );
    }

    const groupCount = confirmed.filter(
      (b) => b.membership.type === MembershipType.GROUP
    ).length;

    const privateCount = confirmed.filter(
      (b) => b.membership.type === MembershipType.PRIVATE
    ).length;

    if (membership.type === MembershipType.PRIVATE) {
      if (groupCount > 0 || privateCount > 0) {
        throw new OfflineAttendeeError(
          409,
          "SESSION_OCCUPIED",
          "This session is already occupied and cannot be booked privately."
        );
      }
    } else if (membership.type === MembershipType.GROUP) {
      if (privateCount > 0) {
        throw new OfflineAttendeeError(
          409,
          "SESSION_PRIVATE",
          "This session is reserved for a private booking."
        );
      }

      const capacity = Math.min(
        5,
        session.capacity ?? session.schedule.capacity
      );

      if (groupCount >= capacity) {
        throw new OfflineAttendeeError(409, "SESSION_FULL", "This group session is full.");
      }
    } else {
      throw new OfflineAttendeeError(400, "VALIDATION_ERROR", "Unsupported class type.");
    }

    const amount = data.amount ?? membership.price;

    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new OfflineAttendeeError(400, "VALIDATION_ERROR", "Amount must be a non-negative integer.");
    }

    const paymentReference =
      `OFFLINE-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

    const booking = await tx.booking.create({
      data: {
        fullName,
        email,
        phone,
        sessionId,
        scheduleId: session.scheduleId,
        classId: session.schedule.className,
        bookingDate: session.sessionDate,
        membershipId: membership.id,
        amount,
        paymentReference,
        paymentMethod: PaymentMethod.OFFLINE,
        paymentStatus: PaymentStatus.PAID,
        bookingStatus: BookingStatus.CONFIRMED,
        availableDays: [],
        preferredTimes: [],
      },
    });

    return {
      booking,
      ratePlan: { id: membership.id, name: membership.name, type: membership.type, price: membership.price },
    };
  });

  return {
    ...result.booking,
    // Additive, for clarity in admin views.
    attendeeType: "OFFLINE_ATTENDEE" as const,
    bookingType: result.ratePlan.type,
    // The plan/package recorded as paid for (booking.membershipId).
    // Record-keeping only: no membership is created or activated.
    ratePlan: result.ratePlan,
  };
}

  /**
   * When the class ends (UTC instant). sessionDate holds the Lagos date
   * at UTC midnight; endTime is Lagos local time (UTC+1). An unreadable
   * end time counts as the end of that Lagos day.
   */
  private getSessionEndAt(sessionDate: Date, endTime: string): Date {
    try {
      return this.getSessionStartAt(sessionDate, endTime.trim());
    } catch {
      return new Date(
        Date.UTC(
          sessionDate.getUTCFullYear(),
          sessionDate.getUTCMonth(),
          sessionDate.getUTCDate(),
          23 - 1,
          59
        )
      );
    }
  }

  /**
   * Add an existing registered member to a session (admin). Not an
   * offline attendee: the booking is linked to the member's account and
   * appears in their booking history.
   *
   * Uses the member booking core (BookingService.createMemberSessionBooking):
   * the same session lock, two-hour rule, OPEN/active checks, member lock,
   * GROUP/PRIVATE capacity, duplicate check and Google Calendar event.
   *
   * - USE_CREDIT: the member's eligible membership of `bookingType`, by
   *   the normal selection rules; exactly one credit used (none for
   *   unlimited); first-booking start dates as normal. Cancelling
   *   restores that credit to the same membership.
   * - PAID_OFFLINE: the amount paid at the studio, OFFLINE/PAID; no
   *   membership used, assigned or created, no credit moves.
   *   `ratePlanId` is the class type/rate (a catalogue plan), as for
   *   offline attendees; the amount defaults to its price.
   *
   * No health declaration is created: the admin can't accept one on the
   * member's behalf. The member's next dashboard declaration update
   * applies to this booking (it is upcoming and CONFIRMED).
   */
  async addMemberToSession(
    sessionId: string,
    data: {
      userId: string;
      mode: "USE_CREDIT" | "PAID_OFFLINE";
      bookingType?: "GROUP" | "PRIVATE";
      ratePlanId?: string;
      amount?: number;
    }
  ) {
    const user = await prisma.user.findUnique({
      where: { id: data.userId },
      select: { id: true, role: true },
    });

    if (!user || user.role !== UserRole.MEMBER) {
      throw new OfflineAttendeeError(404, "MEMBER_NOT_FOUND", "Registered member not found.");
    }

    let bookingType = data.bookingType as MembershipType | undefined;
    let ratePlan: { id: string; type: MembershipType } | undefined;
    let amount: number | undefined;

    if (data.mode === "PAID_OFFLINE") {
      const plan = data.ratePlanId
        ? await prisma.membership.findUnique({ where: { id: data.ratePlanId } })
        : null;

      if (!plan || !plan.isActive) {
        throw new OfflineAttendeeError(400, "VALIDATION_ERROR", "Select an active class type/rate.");
      }

      if (bookingType && bookingType !== plan.type) {
        throw new OfflineAttendeeError(
          400,
          "VALIDATION_ERROR",
          `The selected rate is for ${plan.type.toLowerCase()} classes, not ${bookingType.toLowerCase()}.`
        );
      }

      bookingType = plan.type;
      ratePlan = { id: plan.id, type: plan.type };
      amount = data.amount ?? plan.price;
    }

    if (!bookingType) {
      throw new OfflineAttendeeError(400, "VALIDATION_ERROR", "Class type must be GROUP or PRIVATE.");
    }

    const created = await bookingService.createMemberSessionBooking({
      userId: user.id,
      sessionId,
      bookingType,
      mode: data.mode,
      ratePlan,
      amount,
      referencePrefix: "ADMIN",
    });

    const booking = await bookingService.addBookingCalendarEvent(created);

    // The funding membership as committed (after the credit was used).
    const funded = booking.memberMembershipId
      ? await prisma.memberMembership.findUnique({
          where: { id: booking.memberMembershipId },
          select: { creditsTotal: true, creditsUsed: true },
        })
      : null;
    const creditsDeducted = funded && funded.creditsTotal !== null ? 1 : 0;

    return {
      booking,
      mode: data.mode,
      bookingType,
      creditsDeducted,
      // That membership's remaining balance (null when unlimited or paid offline).
      creditsRemaining:
        funded && funded.creditsTotal !== null
          ? Math.max(funded.creditsTotal - funded.creditsUsed, 0)
          : null,
    };
  }

  /**
   * Cancel an upcoming class session.
   *
   * We do NOT delete the session because the session record
   * is useful for historical/reference purposes.
   */
  async cancelSession(sessionId: string) {
    const session = await prisma.classSession.findUnique({
      where: {
        id: sessionId,
      },
      include: {
        schedule: true,
        bookings: {
          where: {
            bookingStatus: "CONFIRMED",
          },
        },
      },
    });

    if (!session) {
      throw new Error("Class session not found.");
    }

const sessionStartAt = this.getSessionStartAt(
  session.sessionDate,
  session.schedule.startTime
);

if (sessionStartAt <= new Date()) {
      throw new Error(
        "A session that has already started cannot be cancelled."
      );
    }

    if (session.status === "COMPLETED") {
      throw new Error(
        "A completed session cannot be cancelled."
      );
    }

    if (session.status === "CANCELLED") {
      throw new Error(
        "This session is already cancelled."
      );
    }

    const updatedSession = await prisma.$transaction(
      async (tx) => {
        /**
         * Cancel the session.
         */
        const updated = await tx.classSession.update({
          where: {
            id: sessionId,
          },
          data: {
            status: "CANCELLED",
          },
        });

        /**
         * Cancel all confirmed bookings attached
         * to this session.
         *
         * NOTE:
         * We restore member credits here because the
         * class itself was cancelled by the studio.
         */
        for (const booking of session.bookings) {
          await tx.booking.update({
            where: {
              id: booking.id,
            },
            data: {
              bookingStatus: "CANCELLED",
            },
          });

          if (booking.memberMembershipId) {
            const memberMembership =
              await tx.memberMembership.findUnique({
                where: {
                  id: booking.memberMembershipId,
                },
              });

            if (
              memberMembership &&
              memberMembership.creditsTotal !== null &&
              memberMembership.creditsUsed > 0
            ) {
              await tx.memberMembership.update({
                where: {
                  id: memberMembership.id,
                },
                data: {
                  creditsUsed: {
                    decrement: 1,
                  },
                },
              });
            }
          }
        }

        return updated;
      }
    );

    return {
      message: "Class session cancelled successfully.",
      session: updatedSession,
      cancelledBookings: session.bookings.length,
      creditsRestored: session.bookings.filter(
        (booking) => booking.memberMembershipId !== null
      ).length,
    };
  }

  /**
   * Reopen a cancelled session.
   *
   * Only use this when the studio wants the session
   * to become bookable again.
   */

  async reopenSession(sessionId: string) {
    const session = await prisma.classSession.findUnique({
      where: {
        id: sessionId,
      },
      include: {
        schedule: true,
      },
    });

    if (!session) {
      throw new Error("Class session not found.");
    }

    if (session.status !== "CANCELLED") {
      throw new Error(
        "Only cancelled sessions can be reopened."
      );
    }

    const sessionStartAt = this.getSessionStartAt(
      session.sessionDate,
      session.schedule.startTime
    );

    if (sessionStartAt <= new Date()) {
      throw new Error(
        "A session that has already started cannot be reopened."
      );
    }

    const updatedSession = await prisma.classSession.update({
      where: {
        id: sessionId,
      },
      data: {
        status: "OPEN",
      },
    });

    return {
      message: "Class session reopened successfully.",
      session: updatedSession,
    };
  }

}

export default new AdminSessionService();