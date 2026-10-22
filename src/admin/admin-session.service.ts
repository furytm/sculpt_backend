import prisma from "../config/prisma.js";
import crypto from "crypto";

import {
  BookingStatus,
  MembershipType,
  PaymentMethod,
  PaymentStatus,
} from "@prisma/client";

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
  membership: {
    select: {
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
    membership: {
      select: {
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

  
async addOfflineAttendee(
  sessionId: string,
  data: {
    fullName: string;
    email?: string;
    phone?: string;
    membershipId: string;
    amount?: number;
    paymentStatus?: "PAID" | "PENDING";
  }
) {
  const fullName = data.fullName?.trim();
  const email = data.email?.trim().toLowerCase() || null;
  const phone = data.phone?.trim() || null;

  if (!fullName) {
    throw new Error("Attendee name is required.");
  }

  if (!sessionId) {
    throw new Error("Session ID is required.");
  }

  if (!data.membershipId) {
    throw new Error("Membership ID is required.");
  }

  const paymentStatus =
    data.paymentStatus ?? "PAID";

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
      throw new Error("Class session not found.");
    }

    if (session.status !== "OPEN") {
      throw new Error("This class session is not open.");
    }

    if (!session.schedule.isActive) {
      throw new Error("This class schedule is not active.");
    }

    const membership = await tx.membership.findUnique({
      where: { id: data.membershipId },
    });

    if (!membership || !membership.isActive) {
      throw new Error("An active membership is required.");
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
        membership: { select: { type: true } },
      },
    });

    const groupCount = confirmed.filter(
      (b) => b.membership.type === MembershipType.GROUP
    ).length;

    const privateCount = confirmed.filter(
      (b) => b.membership.type === MembershipType.PRIVATE
    ).length;

    if (membership.type === MembershipType.PRIVATE) {
      if (groupCount > 0 || privateCount > 0) {
        throw new Error(
          "This session is already occupied and cannot be booked privately."
        );
      }
    } else if (membership.type === MembershipType.GROUP) {
      if (privateCount > 0) {
        throw new Error(
          "This session is reserved for a private booking."
        );
      }

      const capacity = Math.min(
        5,
        session.capacity ?? session.schedule.capacity
      );

      if (groupCount >= capacity) {
        throw new Error("This group session is full.");
      }
    } else {
      throw new Error("Unsupported membership type.");
    }

    const amount = data.amount ?? membership.price;

    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new Error("Amount must be a non-negative integer.");
    }

    const paymentReference =
      `OFFLINE-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

    return tx.booking.create({
      data: {
        fullName,
        email,
        phone,
        sessionId,
        scheduleId: session.scheduleId,
        classId: session.schedule.className,
        membershipId: membership.id,
        amount,
        paymentReference,
        paymentMethod: PaymentMethod.OFFLINE,
        paymentStatus:
          paymentStatus === "PAID"
            ? PaymentStatus.PAID
            : PaymentStatus.PENDING,
        bookingStatus:
          paymentStatus === "PAID"
            ? BookingStatus.CONFIRMED
            : BookingStatus.PENDING,
        availableDays: [],
        preferredTimes: [],
      },
    });
  });

  return result;
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