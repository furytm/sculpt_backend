import crypto from "crypto";

import prisma from "../config/prisma.js";
import paymentService from "../payment/payment.service.js";

import {
  BookingStatus,
  PaymentMethod,
  PaymentStatus,
  MembershipStatus,
  MembershipType,
  Prisma,
} from "@prisma/client";

import {
  googleCalendarService,
} from "../google-calendar/google-calendar.service.js";

import {
  BookingResponse,
  CreateBookingDto,
  HealthSafetyFormDto,
} from "./booking.types.js";

class BookingService {
  // =========================================================
  // CONSTANTS
  // =========================================================

  private readonly HEALTH_DECLARATION_VERSION = "1.0";

  // How many days of future sessions the availability API
  // should expose.
  private readonly AVAILABILITY_DAYS = 30;

  // =========================================================
  // BOOKING FLOW TOKEN
  // =========================================================

  private generateBookingFlowToken() {
    const token = crypto.randomBytes(32).toString("hex");

    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    return {
      token,
      tokenHash,
    };
  }

  private hashBookingFlowToken(token: string) {
    return crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");
  }

  private async getBookingByFlowToken(
    bookingId: string,
    bookingFlowToken: string
  ) {
    if (!bookingFlowToken) {
      throw new Error(
        "Booking continuation token is required."
      );
    }

    const tokenHash =
      this.hashBookingFlowToken(
        bookingFlowToken
      );

    const booking =
      await prisma.booking.findFirst({
        where: {
          id: bookingId,
          bookingFlowTokenHash: tokenHash,
        },

        include: {
          membership: true,
          healthSafetyForm: true,
          session: {
            include: {
              schedule: true,
            },
          },
        },
      });

    if (!booking) {
      throw new Error(
        "Booking session is invalid or has expired."
      );
    }

    return booking;
  }

  // =========================================================
  // DATE HELPERS
  // =========================================================

  /**
   * Returns the beginning of tomorrow.
   *
   * IMPORTANT:
   * Today is NOT bookable.
   *
   * If today is September 23:
   * September 23 -> invalid
   * September 24 -> first valid date
   */
  private getTomorrowStart() {
    const tomorrow = new Date();

    tomorrow.setHours(
      0,
      0,
      0,
      0
    );

    tomorrow.setDate(
      tomorrow.getDate() + 1
    );

    return tomorrow;
  }

  /**
   * Make sure a selected session date is tomorrow or later.
   */
  private validateFutureSessionDate(
    sessionDate: Date
  ) {
    if (
      Number.isNaN(
        sessionDate.getTime()
      )
    ) {
      throw new Error(
        "Invalid session date."
      );
    }

    const tomorrow =
      this.getTomorrowStart();

    const selectedDate =
      new Date(sessionDate);

    selectedDate.setHours(
      0,
      0,
      0,
      0
    );

    if (
      selectedDate < tomorrow
    ) {
      throw new Error(
        "You can only select sessions from tomorrow onwards."
      );
    }

    return true;
  }

  /**
   * Calculate membership expiry.
   */
  private calculateMembershipExpiry(
    startDate: Date,
    duration: string,
    period: string
  ) {
    const expiryDate =
      new Date(startDate);

    const normalizedDuration =
      duration
        .trim()
        .toLowerCase();

    const normalizedPeriod =
      period
        .trim()
        .toLowerCase();

    // -------------------------------------------------------
    // SINGLE CLASS
    // -------------------------------------------------------

    if (
      normalizedDuration ===
        "single" &&
      normalizedPeriod.includes(
        "class"
      )
    ) {
      expiryDate.setDate(
        expiryDate.getDate() + 30
      );

      return expiryDate;
    }

    // -------------------------------------------------------
    // INTRO WEEK
    // -------------------------------------------------------

    if (
      normalizedDuration ===
      "1 week"
    ) {
      expiryDate.setDate(
        expiryDate.getDate() + 7
      );

      return expiryDate;
    }

    // -------------------------------------------------------
    // MONTHLY
    // -------------------------------------------------------

    if (
      normalizedDuration ===
        "monthly" &&
      normalizedPeriod.includes(
        "month"
      )
    ) {
      expiryDate.setMonth(
        expiryDate.getMonth() + 1
      );

      return expiryDate;
    }

    // -------------------------------------------------------
    // QUARTERLY
    // -------------------------------------------------------

    if (
      normalizedDuration ===
        "quarterly" &&
      normalizedPeriod.includes(
        "3 month"
      )
    ) {
      expiryDate.setMonth(
        expiryDate.getMonth() + 3
      );

      return expiryDate;
    }

    // -------------------------------------------------------
    // ANNUAL
    // -------------------------------------------------------

    if (
      normalizedDuration ===
        "annual" &&
      normalizedPeriod.includes(
        "year"
      )
    ) {
      expiryDate.setFullYear(
        expiryDate.getFullYear() + 1
      );

      return expiryDate;
    }

    // -------------------------------------------------------
    // GENERIC NUMERIC PERIOD
    // -------------------------------------------------------

    const numericDuration =
      Number.parseInt(
        normalizedDuration,
        10
      );

    if (
      !Number.isNaN(
        numericDuration
      ) &&
      numericDuration > 0
    ) {
      if (
        normalizedPeriod.includes(
          "month"
        )
      ) {
        expiryDate.setMonth(
          expiryDate.getMonth() +
            numericDuration
        );

        return expiryDate;
      }

      if (
        normalizedPeriod.includes(
          "week"
        )
      ) {
        expiryDate.setDate(
          expiryDate.getDate() +
            numericDuration * 7
        );

        return expiryDate;
      }

      if (
        normalizedPeriod.includes(
          "day"
        )
      ) {
        expiryDate.setDate(
          expiryDate.getDate() +
            numericDuration
        );

        return expiryDate;
      }

      if (
        normalizedPeriod.includes(
          "year"
        )
      ) {
        expiryDate.setFullYear(
          expiryDate.getFullYear() +
            numericDuration
        );

        return expiryDate;
      }
    }

    // -------------------------------------------------------
    // PRIVATE MEMBERSHIPS
    // -------------------------------------------------------

    if (
      normalizedDuration ===
        "single" &&
      normalizedPeriod.includes(
        "session"
      )
    ) {
      return null;
    }

    if (
      normalizedDuration ===
        "package" &&
      normalizedPeriod.includes(
        "package"
      )
    ) {
      return null;
    }

    throw new Error(
      `Unsupported membership duration: ${duration} (${period})`
    );
  }

  // =========================================================
  // MEMBERSHIP CREDITS
  // =========================================================

  /**
   * Get the number of credits attached to a membership.
   *
   * null = unlimited.
   */
  private getMembershipCredits(
    classLimit: number | null
  ) {
    if (
      classLimit === null ||
      classLimit === undefined
    ) {
      return null;
    }

    return classLimit;
  }

  /**
   * Check whether a membership still has a usable credit.
   */
  private hasRemainingCredit(
    memberMembership: {
      creditsTotal: number | null;
      creditsUsed: number;
    }
  ) {
    // Unlimited
    if (
      memberMembership.creditsTotal ===
      null
    ) {
      return true;
    }

    return (
      memberMembership.creditsUsed <
      memberMembership.creditsTotal
    );
  }

  // =========================================================
  // CREATE BOOKING
  // =========================================================

  async createBooking(
    data: CreateBookingDto
  ): Promise<BookingResponse> {
    if (!data.fullName?.trim()) {
      throw new Error(
        "Full name is required."
      );
    }

    if (!data.email?.trim()) {
      throw new Error(
        "Email is required."
      );
    }

    if (!data.phone?.trim()) {
      throw new Error(
        "Phone number is required."
      );
    }

    if (!data.membershipId) {
      throw new Error(
        "Membership is required."
      );
    }

    // -------------------------------------------------------
    // MEMBERSHIP
    // -------------------------------------------------------

    const membership =
      await prisma.membership.findUnique({
        where: {
          id: data.membershipId,
        },
      });

    if (!membership) {
      throw new Error(
        "Membership not found."
      );
    }

    if (!membership.isActive) {
      throw new Error(
        "This membership is no longer available."
      );
    }

    // -------------------------------------------------------
    // SESSION
    // -------------------------------------------------------

    /**
     * The new flow selects the session BEFORE payment.
     *
     * Your updated DTO should contain:
     *
     * classSessionId?: string
     */
    const classSessionId =
      (data as any).classSessionId;

    if (
      membership.type ===
        MembershipType.GROUP &&
      !classSessionId
    ) {
      throw new Error(
        "Please select an available class session."
      );
    }

    let classSession = null;

    if (classSessionId) {
      classSession =
        await prisma.classSession.findUnique({
          where: {
            id: classSessionId,
          },

          include: {
            schedule: true,

            _count: {
              select: {
                bookings: {
                  where: {
                    bookingStatus:
                      BookingStatus.CONFIRMED,
                  },
                },
              },
            },
          },
        });

      if (!classSession) {
        throw new Error(
          "Selected class session was not found."
        );
      }

      if (
        !classSession.schedule.isActive
      ) {
        throw new Error(
          "This class schedule is no longer active."
        );
      }

      if (
        classSession.status !==
        "OPEN"
      ) {
        throw new Error(
          "This class session is no longer available."
        );
      }

      // -----------------------------------------------------
      // TOMORROW ONWARD
      // -----------------------------------------------------

      this.validateFutureSessionDate(
        classSession.sessionDate
      );

      // -----------------------------------------------------
      // CLASS MATCH
      // -----------------------------------------------------

      if (
        data.classId &&
        classSession.schedule.className
          .toLowerCase() !==
          data.classId.toLowerCase()
      ) {
        throw new Error(
          "The selected session does not belong to the selected class."
        );
      }

      // -----------------------------------------------------
      // CAPACITY
      // -----------------------------------------------------

      const capacity =
        classSession.capacity ??
        classSession.schedule.capacity;

      const bookedCount =
        classSession._count.bookings;

      if (
        bookedCount >= capacity
      ) {
        throw new Error(
          "This class session is already full."
        );
      }
    }

    // -------------------------------------------------------
    // HEALTH DECLARATION
    // -------------------------------------------------------

    const healthDeclaration =
      (data as any).healthDeclaration;

    if (
      !healthDeclaration ||
      healthDeclaration.accepted !== true
    ) {
      throw new Error(
        "You must accept the Health Declaration before payment."
      );
    }

    // -------------------------------------------------------
    // PAYMENT REFERENCE
    // -------------------------------------------------------

    const paymentReference =
      `SL-${Date.now()}-${crypto
        .randomBytes(4)
        .toString("hex")}`;

    // -------------------------------------------------------
    // FLOW TOKEN
    // -------------------------------------------------------

    const {
      token: bookingFlowToken,
      tokenHash,
    } =
      this.generateBookingFlowToken();

    // -------------------------------------------------------
    // CREATE BOOKING
    // -------------------------------------------------------

    const booking =
      await prisma.$transaction(
        async (tx) => {
          // Recheck session capacity inside transaction.
          if (classSession) {
            await tx.$queryRaw`
              SELECT id
              FROM "ClassSession"
              WHERE id = ${classSession.id}
              FOR UPDATE
            `;

            const latestSession =
              await tx.classSession.findUnique({
                where: {
                  id: classSession.id,
                },

                include: {
                  schedule: true,

                  _count: {
                    select: {
                      bookings: {
                        where: {
                          bookingStatus:
                            BookingStatus.CONFIRMED,
                        },
                      },
                    },
                  },
                },
              });

            if (!latestSession) {
              throw new Error(
                "Selected class session was not found."
              );
            }

            this.validateFutureSessionDate(
              latestSession.sessionDate
            );

            const capacity =
              latestSession.capacity ??
              latestSession.schedule.capacity;

            if (
              latestSession._count.bookings >=
              capacity
            ) {
              throw new Error(
                "This class session has just become full. Please select another session."
              );
            }
          }

          const createdBooking =
            await tx.booking.create({
              data: {
                fullName:
                  data.fullName.trim(),

                email:
                  data.email
                    .trim()
                    .toLowerCase(),

                phone:
                  data.phone.trim(),

                userId: null,

                classId:
                  data.classId ??
                  classSession?.schedule
                    .className ??
                  null,

                sessionId:
                  classSession?.id ??
                  null,

                // Keep old scheduleId populated
                // for compatibility with existing
                // Booking relations.
                scheduleId:
                  classSession?.scheduleId ??
                  null,

                bookingDate:
                  classSession?.sessionDate ??
                  null,

                preferredStartDate:
                  classSession?.sessionDate ??
                  null,

                membershipId:
                  membership.id,

                amount:
                  membership.price,

                paymentMethod:
                  data.paymentMethod ===
                  "OFFLINE"
                    ? PaymentMethod.OFFLINE
                    : PaymentMethod.PAYMISH,

                paymentReference,

                paymentStatus:
                  PaymentStatus.PENDING,

                bookingStatus:
                  BookingStatus.PENDING,

                bookingFlowTokenHash:
                  tokenHash,
              },

              include: {
                membership: true,

                session: {
                  include: {
                    schedule: true,
                  },
                },
              },
            });

          // -------------------------------------------------
          // SAVE HEALTH DECLARATION BEFORE PAYMENT
          // -------------------------------------------------

          await tx.healthSafetyForm.create({
            data: {
              bookingId:
                createdBooking.id,

              userId: null,

              accepted: true,

              declarationVersion:
                this.HEALTH_DECLARATION_VERSION,

              notes:
                healthDeclaration.notes
                  ?.trim() || null,

              acceptedAt:
                new Date(),

              submittedAt:
                new Date(),

              screeningAnswers:
                {},

              consent:
                [],
            },
          });

          return createdBooking;
        }
      );

    // -------------------------------------------------------
    // OFFLINE
    // -------------------------------------------------------

    if (
      data.paymentMethod ===
      "OFFLINE"
    ) {
      return {
        booking,

        paymentMethod:
          PaymentMethod.OFFLINE,

        authorizationUrl: null,

        bookingFlowToken,
      };
    }

    // -------------------------------------------------------
    // PAYMISH
    // -------------------------------------------------------

    const payment =
      await paymentService
        .initializeTransaction({
          email:
            booking.email,

          amount:
            booking.amount,

          reference:
            paymentReference,
        });

    return {
      booking,

      paymentMethod:
        PaymentMethod.PAYMISH,

      authorizationUrl:
        payment.data.authorization_url,

      bookingFlowToken,
    };
  }

  // =========================================================
  // INITIALIZE PAYMENT
  // =========================================================

  /**
   * This method can be used if you decide to create the
   * booking first and initialize payment separately.
   */
  async initializePayment(
    bookingId: string,
    bookingFlowToken: string
  ) {
    const booking =
      await this.getBookingByFlowToken(
        bookingId,
        bookingFlowToken
      );

    if (
      booking.paymentStatus ===
      PaymentStatus.PAID
    ) {
      throw new Error(
        "This booking has already been paid for."
      );
    }

    if (
      booking.bookingStatus !==
      BookingStatus.PENDING
    ) {
      throw new Error(
        "This booking is no longer available for payment."
      );
    }

    const payment =
      await paymentService
        .initializeTransaction({
          email:
            booking.email,

          amount:
            booking.amount,

          reference:
            booking.paymentReference,
        });

    return {
      authorizationUrl:
        payment.data.authorization_url,

      accessCode:
        payment.data.access_code,

      reference:
        payment.data.reference ??
        booking.paymentReference,
    };
  }

  // =========================================================
  // GET BOOKING
  // =========================================================

  async getBookingById(
    id: string
  ) {
    return await prisma.booking.findUnique({
      where: {
        id,
      },

      include: {
        membership: true,

        user: true,

        session: {
          include: {
            schedule: true,
          },
        },

        schedule: true,

        memberMembership: true,

        healthSafetyForm: true,
      },
    });
  }

  // =========================================================
  // MARK BOOKING PAID
  // =========================================================

  async markBookingPaid(
    reference: string
  ) {
    if (!reference) {
      throw new Error(
        "Payment reference is required."
      );
    }

    const booking =
      await prisma.booking.findUnique({
        where: {
          paymentReference:
            reference,
        },
      });

    if (!booking) {
      throw new Error(
        "Booking not found."
      );
    }

    if (
      booking.paymentStatus ===
      PaymentStatus.PAID
    ) {
      return booking;
    }

    return await prisma.booking.update({
      where: {
        id: booking.id,
      },

      data: {
        paymentStatus:
          PaymentStatus.PAID,
      },
    });
  }

  // =========================================================
  // GET BOOKING CONFIRMATION
  // =========================================================

  async getBookingConfirmation(
    reference: string
  ) {
    const booking =
      await prisma.booking.findUnique({
        where: {
          paymentReference:
            reference,
        },

        include: {
          membership: true,

          user: true,

          session: {
            include: {
              schedule: true,
            },
          },

          schedule: true,

          memberMembership: true,

          healthSafetyForm: true,
        },
      });

    if (!booking) {
      throw new Error(
        "Booking not found."
      );
    }

    return booking;
  }

  // =========================================================
  // CONTINUE GUEST BOOKING
  // =========================================================

  async continueGuestBooking(
    reference: string
  ) {
    if (
      !reference ||
      typeof reference !==
        "string"
    ) {
      throw new Error(
        "Payment reference is required."
      );
    }

    const booking =
      await prisma.booking.findUnique({
        where: {
          paymentReference:
            reference,
        },

        include: {
          membership: true,

          user: true,

          session: {
            include: {
              schedule: true,
            },
          },

          schedule: true,

          healthSafetyForm: true,
        },
      });

    if (!booking) {
      throw new Error(
        "Booking not found."
      );
    }

    if (
      booking.paymentStatus !==
      PaymentStatus.PAID
    ) {
      throw new Error(
        "Payment has not been completed for this booking."
      );
    }

    if (
      booking.bookingStatus !==
      BookingStatus.PENDING
    ) {
      if (
        booking.bookingStatus ===
        BookingStatus.CONFIRMED
      ) {
        throw new Error(
          "This booking has already been confirmed."
        );
      }

      throw new Error(
        "This booking is no longer available to continue."
      );
    }

    if (booking.userId) {
      throw new Error(
        "This booking is already attached to an account."
      );
    }

    const {
      token: bookingFlowToken,
      tokenHash,
    } =
      this.generateBookingFlowToken();

    const updatedBooking =
      await prisma.booking.update({
        where: {
          id: booking.id,
        },

        data: {
          bookingFlowTokenHash:
            tokenHash,
        },

        include: {
          membership: true,

          session: {
            include: {
              schedule: true,
            },
          },

          healthSafetyForm: true,
        },
      });

    return {
      booking:
        updatedBooking,

      bookingFlowToken,
    };
  }

  // =========================================================
  // GET MY BOOKINGS
  // =========================================================

  async getMyBookings(
    userId: string
  ) {
    return await prisma.booking.findMany({
      where: {
        userId,
      },

      include: {
        membership: true,

        session: {
          include: {
            schedule: true,
          },
        },

        schedule: true,

        memberMembership: true,

        healthSafetyForm: true,
      },

      orderBy: {
        createdAt: "desc",
      },
    });
  }

  // =========================================================
  // SAVE HEALTH DECLARATION
  // =========================================================

  /**
   * Health declaration happens BEFORE payment.
   *
   * The booking already exists at this point.
   */
  async saveHealthDeclaration(
    bookingId: string,
    bookingFlowToken: string,
    data: {
      accepted: boolean;
      notes?: string;
    }
  ) {
    const booking =
      await this.getBookingByFlowToken(
        bookingId,
        bookingFlowToken
      );

    if (
      booking.bookingStatus !==
      BookingStatus.PENDING
    ) {
      throw new Error(
        "This booking can no longer be changed."
      );
    }

    if (
      data.accepted !== true
    ) {
      throw new Error(
        "You must accept the Health Declaration to continue."
      );
    }

    return await prisma.healthSafetyForm.upsert({
      where: {
        bookingId,
      },

      create: {
        bookingId,

        userId:
          booking.userId ??
          null,

        accepted: true,

        declarationVersion:
          this.HEALTH_DECLARATION_VERSION,

        notes:
          data.notes?.trim() ||
          null,

        acceptedAt:
          new Date(),

        submittedAt:
          new Date(),

        screeningAnswers:
          {},

        consent:
          [],
      },

      update: {
        accepted: true,

        declarationVersion:
          this.HEALTH_DECLARATION_VERSION,

        notes:
          data.notes?.trim() ||
          null,

        acceptedAt:
          new Date(),

        submittedAt:
          new Date(),
      },
    });
  }

  // =========================================================
  // ATTACH BOOKING TO ACCOUNT
  // =========================================================

  async attachBookingAccount(
    bookingId: string,
    userId: string,
    bookingFlowToken: string
  ) {
    const booking =
      await this.getBookingByFlowToken(
        bookingId,
        bookingFlowToken
      );

    if (
      booking.userId &&
      booking.userId !== userId
    ) {
      throw new Error(
        "This booking is already attached to another account."
      );
    }

    return await prisma.$transaction(
      async (tx) => {
        const updatedBooking =
          await tx.booking.update({
            where: {
              id: booking.id,
            },

            data: {
              userId,
            },

            include: {
              membership: true,

              session: {
                include: {
                  schedule: true,
                },
              },

              healthSafetyForm: true,
            },
          });

        await tx.healthSafetyForm.updateMany({
          where: {
            bookingId:
              booking.id,
          },

          data: {
            userId,
          },
        });

        return updatedBooking;
      }
    );
  }

  // =========================================================
  // GET CLASS AVAILABILITY
  // =========================================================

  /**
   * Returns actual future sessions.
   *
   * IMPORTANT:
   *
   * Today is excluded.
   * Tomorrow is the first selectable date.
   */
  async getClassAvailability(
    classId: string,
    fromDate?: string,
    toDate?: string
  ) {
    if (!classId) {
      throw new Error(
        "Class is required."
      );
    }

    // -------------------------------------------------------
    // START DATE
    // -------------------------------------------------------

    let startDate =
      this.getTomorrowStart();

    if (fromDate) {
      const requestedStart =
        new Date(fromDate);

      if (
        Number.isNaN(
          requestedStart.getTime()
        )
      ) {
        throw new Error(
          "Invalid from date."
        );
      }

      this.validateFutureSessionDate(
        requestedStart
      );

      requestedStart.setHours(
        0,
        0,
        0,
        0
      );

      startDate =
        requestedStart;
    }

    // -------------------------------------------------------
    // END DATE
    // -------------------------------------------------------

    let endDate =
      new Date(startDate);

    if (toDate) {
      const requestedEnd =
        new Date(toDate);

      if (
        Number.isNaN(
          requestedEnd.getTime()
        )
      ) {
        throw new Error(
          "Invalid to date."
        );
      }

      requestedEnd.setHours(
        23,
        59,
        59,
        999
      );

      endDate =
        requestedEnd;
    } else {
      endDate.setDate(
        endDate.getDate() +
          this.AVAILABILITY_DAYS
      );

      endDate.setHours(
        23,
        59,
        59,
        999
      );
    }

    if (
      endDate < startDate
    ) {
      throw new Error(
        "The end date cannot be before the start date."
      );
    }

    // -------------------------------------------------------
    // SESSIONS
    // -------------------------------------------------------

    const sessions =
      await prisma.classSession.findMany({
        where: {
          sessionDate: {
            gte: startDate,
            lte: endDate,
          },

          status: "OPEN",

          schedule: {
            className: {
              equals: classId,
              mode: "insensitive",
            },

            isActive: true,
          },
        },

        include: {
          schedule: true,

          _count: {
            select: {
              bookings: {
                where: {
                  bookingStatus:
                    BookingStatus.CONFIRMED,
                },
              },
            },
          },
        },

        orderBy: {
          sessionDate: "asc",
        },
      });

    // -------------------------------------------------------
    // FORMAT AVAILABILITY
    // -------------------------------------------------------

    return sessions.map(
      (session) => {
        const capacity =
          session.capacity ??
          session.schedule.capacity;

        const bookedCount =
          session._count.bookings;

        const availableSlots =
          Math.max(
            capacity -
              bookedCount,
            0
          );

        return {
          id: session.id,

          classId:
            session.schedule.className,

          className:
            session.schedule.className,

          tutorName:
            session.schedule.tutorName,

          code:
            session.schedule.code,

          sessionDate:
            session.sessionDate,

          dayOfWeek:
            session.schedule.dayOfWeek,

          startTime:
            session.schedule.startTime,

          endTime:
            session.schedule.endTime,

          capacity,

          bookedCount,

          availableSlots,

          isAvailable:
            availableSlots > 0,

          status:
            session.status,
        };
      }
    );
  }

  // =========================================================
  // GET SINGLE SESSION AVAILABILITY
  // =========================================================

  async getSessionAvailability(
    sessionId: string
  ) {
    const session =
      await prisma.classSession.findUnique({
        where: {
          id: sessionId,
        },

        include: {
          schedule: true,

          _count: {
            select: {
              bookings: {
                where: {
                  bookingStatus:
                    BookingStatus.CONFIRMED,
                },
              },
            },
          },
        },
      });

    if (!session) {
      throw new Error(
        "Class session not found."
      );
    }

    this.validateFutureSessionDate(
      session.sessionDate
    );

    const capacity =
      session.capacity ??
      session.schedule.capacity;

    const bookedCount =
      session._count.bookings;

    const availableSlots =
      Math.max(
        capacity -
          bookedCount,
        0
      );

    return {
      id: session.id,

      className:
        session.schedule.className,

      tutorName:
        session.schedule.tutorName,

      sessionDate:
        session.sessionDate,

      dayOfWeek:
        session.schedule.dayOfWeek,

      startTime:
        session.schedule.startTime,

      endTime:
        session.schedule.endTime,

      capacity,

      bookedCount,

      availableSlots,

      isAvailable:
        session.status ===
          "OPEN" &&
        availableSlots > 0,

      status:
        session.status,
    };
  }

  // =========================================================
  // CONFIRM INITIAL BOOKING
  // =========================================================

  /**
   * Called AFTER:
   *
   * 1. Payment is PAID
   * 2. User has registered/logged in
   * 3. Booking is attached to account
   *
   * This creates the membership and consumes the first credit.
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

        include: {
          membership: true,

          memberMembership: true,

          healthSafetyForm: true,

          session: {
            include: {
              schedule: true,
            },
          },
        },
      });

    if (!booking) {
      throw new Error(
        "Booking not found or does not belong to you."
      );
    }

    if (
      booking.bookingStatus ===
      BookingStatus.CONFIRMED
    ) {
      return booking;
    }

    if (
      booking.paymentStatus !==
      PaymentStatus.PAID
    ) {
      throw new Error(
        "This booking has not been paid for."
      );
    }

    if (
      !booking.healthSafetyForm ||
      !booking.healthSafetyForm.accepted
    ) {
      throw new Error(
        "Please complete the Health Declaration before confirming your booking."
      );
    }

  if (
  booking.membership.type ===
    MembershipType.GROUP &&
  !booking.session
) {
  throw new Error(
    "Please select an available class session."
  );
}

    // =======================================================
    // GROUP
    // =======================================================

    if (
      booking.membership.type ===
      MembershipType.GROUP
    ) {
      return await this.confirmGroupBooking(
        bookingId,
        userId
      );
    }

    // =======================================================
    // PRIVATE
    // =======================================================

    return await this.confirmPrivateBooking(
      bookingId,
      userId
    );
  }

  // =========================================================
  // CONFIRM GROUP BOOKING
  // =========================================================

  private async confirmGroupBooking(
    bookingId: string,
    userId: string
  ) {
    const confirmedBooking =
      await prisma.$transaction(
        async (tx) => {
          // -------------------------------------------------
          // LOCK BOOKING
          // -------------------------------------------------

          await tx.$queryRaw`
            SELECT id
            FROM "Booking"
            WHERE id = ${bookingId}
            FOR UPDATE
          `;

          const currentBooking =
            await tx.booking.findUnique({
              where: {
                id: bookingId,
              },

              include: {
                membership: true,

                memberMembership: true,

                healthSafetyForm: true,

                session: {
                  include: {
                    schedule: true,
                  },
                },
              },
            });

          if (!currentBooking) {
            throw new Error(
              "Booking not found."
            );
          }

          if (
            currentBooking.userId !==
            userId
          ) {
            throw new Error(
              "This booking does not belong to your account."
            );
          }

          if (
            currentBooking.bookingStatus ===
            BookingStatus.CONFIRMED
          ) {
            return currentBooking;
          }

          if (
            currentBooking.paymentStatus !==
            PaymentStatus.PAID
          ) {
            throw new Error(
              "This booking has not been paid for."
            );
          }

          if (
            !currentBooking.healthSafetyForm ||
            !currentBooking.healthSafetyForm
              .accepted
          ) {
            throw new Error(
              "Please complete the Health Declaration before confirming your booking."
            );
          }

          const session =
            currentBooking.session;

          if (!session) {
            throw new Error(
              "No class session has been selected."
            );
          }

          // -------------------------------------------------
          // SESSION MUST STILL BE FUTURE
          // -------------------------------------------------

          this.validateFutureSessionDate(
            session.sessionDate
          );

          // -------------------------------------------------
          // SESSION MUST BE OPEN
          // -------------------------------------------------

          if (
            session.status !==
            "OPEN"
          ) {
            throw new Error(
              "This class session is no longer available."
            );
          }

          if (
            !session.schedule.isActive
          ) {
            throw new Error(
              "This class schedule is no longer active."
            );
          }

          // -------------------------------------------------
          // LOCK SESSION
          // -------------------------------------------------

          await tx.$queryRaw`
            SELECT id
            FROM "ClassSession"
            WHERE id = ${session.id}
            FOR UPDATE
          `;

          // -------------------------------------------------
          // RECOUNT BOOKINGS
          // -------------------------------------------------

          const bookedCount =
            await tx.booking.count({
              where: {
                sessionId:
                  session.id,

                bookingStatus:
                  BookingStatus.CONFIRMED,
              },
            });

          const capacity =
            session.capacity ??
            session.schedule.capacity;

          if (
            bookedCount >= capacity
          ) {
            throw new Error(
              "This class session has just become full. Please select another session."
            );
          }

          // -------------------------------------------------
          // MEMBERSHIP EXPIRY
          // -------------------------------------------------

          const membershipStart =
            session.sessionDate;

          const membershipExpiry =
            this.calculateMembershipExpiry(
              membershipStart,
              currentBooking.membership
                .duration,
              currentBooking.membership
                .period
            );

          // -------------------------------------------------
          // CREDITS
          // -------------------------------------------------

          const creditsTotal =
            this.getMembershipCredits(
              currentBooking.membership
                .classLimit
            );

          // -------------------------------------------------
          // CREATE MEMBERSHIP
          // -------------------------------------------------

          let memberMembership =
            currentBooking.memberMembership;

          if (!memberMembership) {
            memberMembership =
              await tx.memberMembership.create({
                data: {
                  userId,

             

                  membershipId:
                    currentBooking.membershipId,

                  status:
                    MembershipStatus.ACTIVE,

                  startDate:
                    membershipStart,

                  expiryDate:
                    membershipExpiry,

                  creditsTotal,

                  creditsUsed:
                    0,
                },
              });
          } else {
            memberMembership =
              await tx.memberMembership.update({
                where: {
                  id:
                    memberMembership.id,
                },

                data: {
                  userId,

                  membershipId:
                    currentBooking.membershipId,

                  status:
                    MembershipStatus.ACTIVE,

                  startDate:
                    membershipStart,

                  expiryDate:
                    membershipExpiry,

                  creditsTotal,
                },
              });
          }

          // -------------------------------------------------
          // CHECK CREDIT
          // -------------------------------------------------

          if (
            !this.hasRemainingCredit(
              memberMembership
            )
          ) {
            throw new Error(
              "You do not have any remaining class credits."
            );
          }

          // -------------------------------------------------
          // CONSUME FIRST CREDIT
          // -------------------------------------------------

          if (
            memberMembership
              .creditsTotal !==
            null
          ) {
            await tx.memberMembership.update({
              where: {
                id:
                  memberMembership.id,
              },

              data: {
                creditsUsed: {
                  increment: 1,
                },
              },
            });
          }

          // -------------------------------------------------
          // CONFIRM BOOKING
          // -------------------------------------------------

          const confirmed =
            await tx.booking.update({
              where: {
                id:
                  currentBooking.id,
              },

              data: {
                bookingStatus:
                  BookingStatus.CONFIRMED,

                bookingDate:
                  session.sessionDate,

                preferredStartDate:
                  session.sessionDate,
              },

              include: {
                membership: true,

                memberMembership: true,

                session: {
                  include: {
                    schedule: true,
                  },
                },

                healthSafetyForm: true,
              },
            });

              return confirmed;
        }
      );

    // =====================================================
    // GOOGLE CALENDAR
    // =====================================================
    //
    // One confirmed booking = one actual ClassSession
    // = one Google Calendar event.
    //
    // Calendar failure does NOT undo the booking.
    // =====================================================

    try {
      const session =
        await prisma.classSession.findUnique({
          where: {
            id: confirmedBooking.sessionId!,
          },

          include: {
            schedule: true,
          },
        });

      if (session) {
        const calendarEvent =
          await googleCalendarService.createBookingEvent({
            bookingId:
              confirmedBooking.id,

            bookingReference:
              confirmedBooking.paymentReference,

            memberName:
              confirmedBooking.fullName,

            memberEmail:
              confirmedBooking.email,

            className:
              session.schedule.className,

            tutorName:
              session.schedule.tutorName,

            sessionDate:
              session.sessionDate,

            startTime:
              session.schedule.startTime,

            endTime:
              session.schedule.endTime,
          });

        if (calendarEvent.eventId) {
          await prisma.booking.update({
            where: {
              id: confirmedBooking.id,
            },

            data: {
              calendarEventId:
                calendarEvent.eventId,

              calendarEventUrl:
                calendarEvent.eventUrl,
            },
          });

          confirmedBooking.calendarEventId =
            calendarEvent.eventId;

          confirmedBooking.calendarEventUrl =
            calendarEvent.eventUrl;
        }

        console.log(
          `✅ Google Calendar event created for booking ${confirmedBooking.id}`
        );
      }
    } catch (calendarError) {
      console.error(
        `⚠️ Google Calendar event creation failed for booking ${confirmedBooking.id}:`,
        calendarError
      );

      // Booking remains CONFIRMED.
      // Calendar failure must not undo successful booking/payment.
    }

    return confirmedBooking;
  }
  // =========================================================
  // CONFIRM PRIVATE BOOKING
  // =========================================================

  private async confirmPrivateBooking(
    bookingId: string,
    userId: string
  ) {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT id
          FROM "Booking"
          WHERE id = ${bookingId}
          FOR UPDATE
        `;

        const booking =
          await tx.booking.findUnique({
            where: {
              id: bookingId,
            },

            include: {
              membership: true,

              memberMembership: true,

              healthSafetyForm: true,
            },
          });

        if (!booking) {
          throw new Error(
            "Booking not found."
          );
        }

        if (
          booking.userId !==
          userId
        ) {
          throw new Error(
            "This booking does not belong to your account."
          );
        }

        if (
          booking.bookingStatus ===
          BookingStatus.CONFIRMED
        ) {
          return booking;
        }

        if (
          booking.paymentStatus !==
          PaymentStatus.PAID
        ) {
          throw new Error(
            "This booking has not been paid for."
          );
        }

        if (
          !booking.healthSafetyForm ||
          !booking.healthSafetyForm
            .accepted
        ) {
          throw new Error(
            "Please complete the Health Declaration before confirming your booking."
          );
        }

        const creditsTotal =
          this.getMembershipCredits(
            booking.membership
              .classLimit
          );

        const membershipStart =
          booking.preferredStartDate ??
          new Date();

        const membershipExpiry =
          this.calculateMembershipExpiry(
            membershipStart,
            booking.membership
              .duration,
            booking.membership
              .period
          );

        let memberMembership =
          booking.memberMembership;

        if (!memberMembership) {
          memberMembership =
            await tx.memberMembership.create({
              data: {
                userId,

           

                membershipId:
                  booking.membershipId,

                status:
                  MembershipStatus.ACTIVE,

                startDate:
                  membershipStart,

                expiryDate:
                  membershipExpiry,

                creditsTotal,

                creditsUsed: 0,
              },
            });
        }

        if (
          !this.hasRemainingCredit(
            memberMembership
          )
        ) {
          throw new Error(
            "You do not have any remaining session credits."
          );
        }

        if (
          memberMembership
            .creditsTotal !==
          null
        ) {
          await tx.memberMembership.update({
            where: {
              id:
                memberMembership.id,
            },

            data: {
              creditsUsed: {
                increment: 1,
              },
            },
          });
        }

        return await tx.booking.update({
          where: {
            id: booking.id,
          },

          data: {
            bookingStatus:
              BookingStatus.CONFIRMED,

            preferredStartDate:
              membershipStart,
          },

          include: {
            membership: true,

            memberMembership: true,

            healthSafetyForm: true,
          },
        });
      }
    );
  }

  // =========================================================
  // BOOK ANOTHER SESSION USING EXISTING MEMBERSHIP
  // =========================================================

  /**
   * Used later from the member dashboard.
   *
   * Example:
   *
   * 10 Classes / Month
   *
   * Member has used 3.
   *
   * creditsTotal = 10
   * creditsUsed  = 3
   *
   * They can book another session.
   */
// =========================================================
// BOOK ANOTHER SESSION USING EXISTING MEMBERSHIP
// =========================================================

/**
 * Used later from the member dashboard.
 *
 * Example:
 *
 * 10 Classes / Month
 *
 * Member has used 3.
 *
 * creditsTotal = 10
 * creditsUsed  = 3
 *
 * They can book another session.
 */
// =========================================================
// BOOK ANOTHER SESSION USING EXISTING MEMBERSHIP
// =========================================================

/**
 * Used later from the member dashboard.
 *
 * Example:
 *
 * 10 Classes / Month
 *
 * Member has used 3.
 *
 * creditsTotal = 10
 * creditsUsed  = 3
 *
 * They can book another session.
 */
// =========================================================
// BOOK ANOTHER SESSION USING EXISTING MEMBERSHIP
// =========================================================

/**
 * Used later from the member dashboard.
 *
 * Example:
 *
 * 10 Classes / Month
 *
 * Member has used 3.
 *
 * creditsTotal = 10
 * creditsUsed  = 3
 *
 * They can book another session.
 */
// =========================================================
// BOOK ANOTHER SESSION USING EXISTING MEMBERSHIP
// =========================================================

/**
 * Used later from the member dashboard.
 *
 * Example:
 *
 * 10 Classes / Month
 *
 * Member has used 3.
 *
 * creditsTotal = 10
 * creditsUsed  = 3
 *
 * They can book another session.
 */
async bookMemberSession(
  userId: string,
  sessionId: string
) {
  if (!userId) {
    throw new Error(
      "Authentication is required."
    );
  }

  if (!sessionId) {
    throw new Error(
      "Class session is required."
    );
  }

  const booking =
    await prisma.$transaction(
      async (tx) => {
        // -----------------------------------------------------
        // LOCK SESSION
        // -----------------------------------------------------

        await tx.$queryRaw`
          SELECT id
          FROM "ClassSession"
          WHERE id = ${sessionId}
          FOR UPDATE
        `;

        const session =
          await tx.classSession.findUnique({
            where: {
              id: sessionId,
            },

            include: {
              schedule: true,

              _count: {
                select: {
                  bookings: {
                    where: {
                      bookingStatus:
                        BookingStatus.CONFIRMED,
                    },
                  },
                },
              },
            },
          });

        if (!session) {
          throw new Error(
            "Class session not found."
          );
        }

        // -----------------------------------------------------
        // TOMORROW ONWARD
        // -----------------------------------------------------

        this.validateFutureSessionDate(
          session.sessionDate
        );

        // -----------------------------------------------------
        // OPEN
        // -----------------------------------------------------

        if (
          session.status !==
          "OPEN"
        ) {
          throw new Error(
            "This class session is no longer available."
          );
        }

        if (
          !session.schedule.isActive
        ) {
          throw new Error(
            "This class schedule is no longer active."
          );
        }

        // -----------------------------------------------------
        // CAPACITY
        // -----------------------------------------------------

        const capacity =
          session.capacity ??
          session.schedule.capacity;

        if (
          session._count.bookings >=
          capacity
        ) {
          throw new Error(
            "This class session is full."
          );
        }

        // -----------------------------------------------------
        // FIND ACTIVE MEMBERSHIP
        // -----------------------------------------------------

        const now =
          new Date();

        const membership =
          await tx.memberMembership.findFirst({
            where: {
              userId,

              status:
                MembershipStatus.ACTIVE,

              OR: [
                {
                  expiryDate: null,
                },

                {
                  expiryDate: {
                    gt: now,
                  },
                },
              ],
            },

            include: {
              membership: true,
            },

            orderBy: {
              expiryDate:
                "asc",
            },
          });

        if (!membership) {
          throw new Error(
            "You do not have an active membership."
          );
        }

        // -----------------------------------------------------
        // CHECK MEMBERSHIP EXPIRY
        // -----------------------------------------------------

        if (
          membership.expiryDate &&
          session.sessionDate >
            membership.expiryDate
        ) {
          throw new Error(
            "This session is outside your membership validity period."
          );
        }

        // -----------------------------------------------------
        // CHECK CREDIT
        // -----------------------------------------------------

        if (
          !this.hasRemainingCredit(
            membership
          )
        ) {
          throw new Error(
            "You do not have any remaining class credits."
          );
        }

        // -----------------------------------------------------
        // PREVENT DUPLICATE SESSION BOOKING
        // -----------------------------------------------------

        const duplicate =
          await tx.booking.findFirst({
            where: {
              userId,

              sessionId:
                session.id,

              bookingStatus:
                BookingStatus.CONFIRMED,
            },
          });

        if (duplicate) {
          throw new Error(
            "You are already booked for this session."
          );
        }

        // -----------------------------------------------------
        // GET MEMBER DETAILS
        // -----------------------------------------------------

        const user =
          await tx.user.findUnique({
            where: {
              id: userId,
            },

            select: {
              fullName: true,
              email: true,
              phone: true,
            },
          });

        if (!user) {
          throw new Error(
            "User account not found."
          );
        }

        // -----------------------------------------------------
        // CREATE SESSION BOOKING
        // -----------------------------------------------------

        const reference =
          `SL-${Date.now()}-${crypto
            .randomBytes(4)
            .toString("hex")}`;

        const createdBooking =
          await tx.booking.create({
            data: {
              fullName:
                user.fullName,

              email:
                user.email,

              phone:
                user.phone ?? "",

              userId,

              classId:
                session.schedule
                  .className,

              sessionId:
                session.id,

              scheduleId:
                session.scheduleId,

              bookingDate:
                session.sessionDate,

              preferredStartDate:
                session.sessionDate,

              membershipId:
                membership.membershipId,

              // Link booking to the active
              // MemberMembership record.
              memberMembershipId:
                membership.id,

              amount: 0,

              paymentReference:
                reference,

              paymentStatus:
                PaymentStatus.PAID,

              paymentMethod:
                PaymentMethod.OFFLINE,

              bookingStatus:
                BookingStatus.CONFIRMED,
            },

            include: {
              membership: true,

              memberMembership: true,

              session: {
                include: {
                  schedule: true,
                },
              },
            },
          });

        // -----------------------------------------------------
        // CONSUME CREDIT
        // -----------------------------------------------------

        if (
          membership.creditsTotal !==
          null
        ) {
          await tx.memberMembership.update({
            where: {
              id:
                membership.id,
            },

            data: {
              creditsUsed: {
                increment: 1,
              },
            },
          });
        }

        return createdBooking;
      },
      {
        maxWait: 10000,
        timeout: 15000,
      }
    );

  // =====================================================
  // GOOGLE CALENDAR
  // =====================================================
  //
  // IMPORTANT:
  // Create the Calendar event AFTER the database
  // transaction has successfully committed.
  //
  // Calendar failure must NOT undo the booking.
  // =====================================================

  try {
    const session =
      await prisma.classSession.findUnique({
        where: {
          id: booking.sessionId!,
        },

        include: {
          schedule: true,
        },
      });

    if (session) {
      const calendarEvent =
        await googleCalendarService.createBookingEvent({
          bookingId:
            booking.id,

          bookingReference:
            booking.paymentReference,

          memberName:
            booking.fullName,

          memberEmail:
            booking.email,

          className:
            session.schedule.className,

          tutorName:
            session.schedule.tutorName,

          sessionDate:
            session.sessionDate,

          startTime:
            session.schedule.startTime,

          endTime:
            session.schedule.endTime,
        });

      // ---------------------------------------------------
      // SAVE CALENDAR EVENT DETAILS
      // ---------------------------------------------------

      if (calendarEvent.eventId) {
        const updatedBooking =
          await prisma.booking.update({
            where: {
              id: booking.id,
            },

            data: {
              calendarEventId:
                calendarEvent.eventId,

              calendarEventUrl:
                calendarEvent.eventUrl,
            },

            include: {
              membership: true,

              memberMembership: true,

              session: {
                include: {
                  schedule: true,
                },
              },
            },
          });

        console.log(
          `✅ Google Calendar event created for booking ${booking.id}`
        );

        return updatedBooking;
      }
    }
  } catch (calendarError) {
    console.error(
      `⚠️ Google Calendar event creation failed for booking ${booking.id}:`,
      calendarError
    );

    // Booking remains CONFIRMED.
    // Calendar failure must not undo the booking.
  }

  return booking;
}
  // =========================================================
  // MEMBERSHIP CREDIT SUMMARY
  // =========================================================

  async getMembershipCreditSummary(
    userId: string
  ) {
    const membership =
      await prisma.memberMembership.findFirst({
        where: {
          userId,

          status:
            MembershipStatus.ACTIVE,

          OR: [
            {
              expiryDate: null,
            },

            {
              expiryDate: {
                gt: new Date(),
              },
            },
          ],
        },

        include: {
          membership: true,
        },

        orderBy: {
          expiryDate:
            "asc",
        },
      });

    if (!membership) {
      return null;
    }

    const remainingCredits =
      membership.creditsTotal ===
      null
        ? null
        : Math.max(
            membership.creditsTotal -
              membership.creditsUsed,
            0
          );

    return {
      memberMembershipId:
        membership.id,

      membership:
        membership.membership,

      creditsTotal:
        membership.creditsTotal,

      creditsUsed:
        membership.creditsUsed,

      remainingCredits,

      unlimited:
        membership.creditsTotal ===
        null,

      startDate:
        membership.startDate,

      expiryDate:
        membership.expiryDate,

      status:
        membership.status,
    };
  }

  // =========================================================
  // LEGACY HEALTH & SAFETY FORM
  // =========================================================

  /**
   * Kept so older frontend calls do not immediately break.
   *
   * New booking flow should use saveHealthDeclaration().
   */
  async saveHealthSafetyForm(
    bookingId: string,
    userId: string,
    data: HealthSafetyFormDto
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

    return await prisma.healthSafetyForm.upsert({
      where: {
        bookingId,
      },

      create: {
        bookingId,

        userId,

        dateOfBirth:
          data.dateOfBirth
            ? new Date(
                data.dateOfBirth
              )
            : null,

        age:
          data.age ??
          null,

        emergencyContactName:
          data.emergencyContactName ||
          null,

        emergencyContactRelationship:
          data.emergencyContactRelationship ||
          null,

        emergencyContactPhone:
          data.emergencyContactPhone ||
          null,

        pregnancy:
          data.pregnancy ||
          null,

        pregnancyWeeks:
          data.pregnancyWeeks ??
          null,

        dueDate:
          data.dueDate
            ? new Date(
                data.dueDate
              )
            : null,

        pregnancyClearance:
          data.pregnancyClearance ||
          null,

        postpartum:
          data.postpartum ||
          null,

        deliveryDate:
          data.deliveryDate
            ? new Date(
                data.deliveryDate
              )
            : null,

        postpartumClearance:
          data.postpartumClearance ||
          null,

        screeningAnswers:
          data.screeningAnswers ||
          {},

        surgery:
          data.surgery ||
          null,

        surgeryDetails:
          data.surgeryDetails ||
          null,

        surgeryClearance:
          data.surgeryClearance ||
          null,

        consent:
          data.consent ||
          [],

        signature:
          data.signature ||
          null,

        submittedAt:
          new Date(),
      },

      update: {
        dateOfBirth:
          data.dateOfBirth
            ? new Date(
                data.dateOfBirth
              )
            : null,

        age:
          data.age ??
          null,

        emergencyContactName:
          data.emergencyContactName ||
          null,

        emergencyContactRelationship:
          data.emergencyContactRelationship ||
          null,

        emergencyContactPhone:
          data.emergencyContactPhone ||
          null,

        pregnancy:
          data.pregnancy ||
          null,

        pregnancyWeeks:
          data.pregnancyWeeks ??
          null,

        dueDate:
          data.dueDate
            ? new Date(
                data.dueDate
              )
            : null,

        pregnancyClearance:
          data.pregnancyClearance ||
          null,

        postpartum:
          data.postpartum ||
          null,

        deliveryDate:
          data.deliveryDate
            ? new Date(
                data.deliveryDate
              )
            : null,

        postpartumClearance:
          data.postpartumClearance ||
          null,

        screeningAnswers:
          data.screeningAnswers ||
          {},

        surgery:
          data.surgery ||
          null,

        surgeryDetails:
          data.surgeryDetails ||
          null,

        surgeryClearance:
          data.surgeryClearance ||
          null,

        consent:
          data.consent ||
          [],

        signature:
          data.signature ||
          null,

        submittedAt:
          new Date(),
      },
    });
  }

 /**
 * Cancel a confirmed booking.
 *
 * Rules:
 * - Booking must exist.
 * - Booking must belong to the authenticated user.
 * - Booking must currently be CONFIRMED.
 * - The class session must still be in the future.
 * - Finite memberships get 1 credit restored.
 * - Unlimited memberships do not need credit restoration.
 * - Google Calendar event is deleted after the transaction succeeds.
 */
async cancelBooking(bookingId: string, userId: string) {
  const result = await prisma.$transaction(
    async (tx) => {
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
       * Make sure the authenticated member owns this booking.
       */
      if (booking.userId !== userId) {
        throw new Error(
          "You are not authorized to cancel this booking."
        );
      }

      /**
       * Only confirmed bookings can be cancelled.
       */
      if (booking.bookingStatus !== "CONFIRMED") {
        throw new Error(
          "Only confirmed bookings can be cancelled."
        );
      }

      /**
       * A confirmed group booking should have a session.
       */
      if (!booking.session) {
        throw new Error(
          "This booking does not have an associated class session."
        );
      }

      const now = new Date();

      const sessionDate = new Date(
        booking.session.sessionDate
      );

      /**
       * Do not allow cancellation after the session has started.
       */
      if (sessionDate <= now) {
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
          bookingStatus: "CANCELLED",
        },

        include: {
          membership: true,
          memberMembership: true,

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
       * so there is nothing to restore.
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
       * Recalculate confirmed bookings after cancellation.
       */
      const session = booking.session;

      const confirmedBookingCount =
        await tx.booking.count({
          where: {
            sessionId: session.id,
            bookingStatus: "CONFIRMED",
          },
        });

      const sessionCapacity =
        session.capacity ??
        session.schedule.capacity;

      /**
       * If the session was FULL and now has space,
       * reopen it.
       */
      if (
        session.status === "FULL" &&
        confirmedBookingCount < sessionCapacity
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
        message: "Booking cancelled successfully.",

        booking: cancelledBooking,

        creditRestored,

        calendarEventId:
          booking.calendarEventId,

        session: {
          id: session.id,
          capacity: sessionCapacity,
          bookedCount: confirmedBookingCount,
          availableSlots: Math.max(
            sessionCapacity - confirmedBookingCount,
            0
          ),
        },
      };
    },
    {
      maxWait: 10000,
      timeout: 15000,
    }
  );

  // =====================================================
  // GOOGLE CALENDAR CLEANUP
  // =====================================================
  //
  // Do this AFTER the database transaction succeeds.
  // Never call Google Calendar while the Prisma transaction
  // is still open.
  // =====================================================

  if (result.calendarEventId) {
    try {
      await googleCalendarService.deleteBookingEvent(
        result.calendarEventId
      );

      console.log(
        `✅ Google Calendar event deleted for cancelled booking ${bookingId}`
      );
    } catch (calendarError) {
      console.error(
        `⚠️ Failed to remove Google Calendar event for cancelled booking ${bookingId}:`,
        calendarError
      );
    }
  }

  return result;
}
}

export default new BookingService();