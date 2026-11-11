import crypto from "crypto";

import prisma from "../config/prisma.js";
import paymentService from "../payment/payment.service.js";

import {
  BookingStatus,
  PaymentMethod,
  PaymentStatus,
  MembershipPurchaseType,
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
   * Build the actual class start timestamp.
   * Assumes sessionDate is stored at UTC midnight and
   * schedule.startTime is Lagos local time (UTC+1).
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
   * A session is bookable/cancellable only when its actual
   * start time is at least two hours away.
   */
  private isSessionAtLeastTwoHoursAhead(
    sessionDate: Date,
    startTime: string
  ): boolean {
    const sessionStartAt = this.getSessionStartAt(
      sessionDate,
      startTime
    );

    return (
      sessionStartAt.getTime() >=
      Date.now() + 2 * 60 * 60 * 1000
    );
  }

  
  private async assertSessionAvailable(
    tx: Prisma.TransactionClient,
    sessionId: string,
    requestedType: MembershipType
  ) {
    const session = await tx.classSession.findUnique({
      where: { id: sessionId },
      include: {
        schedule: true,
      },
    });

    if (!session) {
      throw new Error("Class session not found.");
    }

    if (session.status !== "OPEN") {
      throw new Error("This class session is no longer available.");
    }

    if (!session.schedule.isActive) {
      throw new Error("This class schedule is no longer active.");
    }
if (!this.isSessionAtLeastTwoHoursAhead(
  session.sessionDate,
  session.schedule.startTime
)) {
  throw new Error(
    "This session must start at least two hours from now."
  );
}

    const confirmedGroupCount = await tx.booking.count({
      where: {
        sessionId,
        bookingStatus: BookingStatus.CONFIRMED,
        membership: {
          type: MembershipType.GROUP,
        },
      },
    });

    const confirmedPrivateCount = await tx.booking.count({
      where: {
        sessionId,
        bookingStatus: BookingStatus.CONFIRMED,
        membership: {
          type: MembershipType.PRIVATE,
        },
      },
    });

 const capacity = Math.min(
  5,
  session.capacity ?? session.schedule.capacity
);

    if (requestedType === MembershipType.PRIVATE) {
      if (confirmedGroupCount > 0 || confirmedPrivateCount > 0) {
        throw new Error(
          "This session is already occupied and cannot be booked privately."
        );
      }
    } else {
      if (confirmedPrivateCount > 0) {
        throw new Error(
          "This session is reserved for a private booking."
        );
      }

      if (confirmedGroupCount >= capacity) {
        throw new Error("This group session is full.");
      }
    }

    return {
      session,
      capacity,
      confirmedGroupCount,
      confirmedPrivateCount,
      availableSlots:
        requestedType === MembershipType.PRIVATE
          ? 1
          : Math.max(capacity - confirmedGroupCount, 0),
    };
  }

  /**
   * Calculate membership expiry.
   *
   * Public so membership renewal and upgrade use the same duration
   * rules as first-booking activation. Returns null for packages
   * with no time limit.
   */
  calculateMembershipExpiry(
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

  /**
   * A membership whose validity has not started waits for its first
   * booked session, and its startDate is still null. That covers:
   * - a NEW membership bought without a first session;
   * - a RENEWAL or UPGRADE completed when the member had no running
   *   validity (expired, or not started yet);
   * - an offline-onboarded or admin-added membership with no session
   *   or start date yet (these have no purchase record);
   * - an offline purchase whose selected first class couldn't be
   *   booked: whichever class is confirmed first (that one on an admin
   *   retry, or one the member books) starts it.
   *
   * A purchase whose first session was booked at checkout (Paymish) or
   * confirmed already has a startDate, so it is never awaiting.
   *
   * The first booking sets startDate (see bookMemberSession), so a
   * started membership is never awaiting again, whatever happens
   * to that booking later. Only a confirmed booking for an actual
   * session counts as the first session. An offline onboarding
   * booking is confirmed but has no session, so it doesn't count.
   * The confirmed-booking check also keeps rows booked before startDate
   * activation existed (those bookings always have a session) from
   * being treated as awaiting.
   */
  private isAwaitingFirstBooking(row: {
    startDate: Date | null;
    membershipPurchase: {
      type: MembershipPurchaseType;
      firstSessionId: string | null;
    } | null;
    bookings: { bookingStatus: BookingStatus; sessionId: string | null }[];
  }) {
    return (
      row.startDate === null &&
      !row.bookings.some(
        (booking) =>
          booking.bookingStatus === BookingStatus.CONFIRMED &&
          booking.sessionId !== null
      )
    );
  }

  /**
   * Expiry for a membership started by its first booking.
   *
   * When this membership is an upgrade of an unstarted membership,
   * none of the replaced package's time was used, so its duration is
   * added before the upgraded package's own. Replaced rows are found
   * through previousMemberMembershipId. Only rows the upgrade replaced
   * (EXPIRED) while they were unstarted (startDate null) count. Days
   * of a membership that had started and expired are never added.
   */
  private async calculateFirstBookingExpiry(
    tx: Prisma.TransactionClient,
    userId: string,
    row: {
      membership: { duration: string; period: string };
      membershipPurchase: {
        type: MembershipPurchaseType;
        previousMemberMembershipId: string | null;
      } | null;
    },
    startDate: Date
  ): Promise<Date | null> {
    const replacedPackages: { duration: string; period: string }[] = [];

    if (row.membershipPurchase?.type === MembershipPurchaseType.UPGRADE) {
      let previousId = row.membershipPurchase.previousMemberMembershipId;
      const seen = new Set<string>();

      while (previousId && !seen.has(previousId)) {
        seen.add(previousId);

        const previous = await tx.memberMembership.findFirst({
          where: { id: previousId, userId },
          include: {
            membership: true,
            membershipPurchase: {
              select: { previousMemberMembershipId: true },
            },
          },
        });

        if (
          !previous ||
          previous.startDate !== null ||
          previous.status !== MembershipStatus.EXPIRED
        ) {
          break;
        }

        // Oldest package first.
        replacedPackages.unshift(previous.membership);

        previousId =
          previous.membershipPurchase?.previousMemberMembershipId ?? null;
      }
    }

    let validUntil = startDate;

    for (const plan of replacedPackages) {
      // A package with no time limit adds no days.
      validUntil =
        this.calculateMembershipExpiry(
          validUntil,
          plan.duration,
          plan.period
        ) ?? validUntil;
    }

    return this.calculateMembershipExpiry(
      validUntil,
      row.membership.duration,
      row.membership.period
    );
  }

  /**
   * After a first booking starts a membership, start the other
   * packages of the same type the member bought while it was
   * unstarted: renewals of it, or further membership-only purchases.
   * They follow in purchase order. Each begins when the one before
   * it ends and adds its own full duration, so every package bought
   * counts once.
   */
  private async startQueuedMemberships(
    tx: Prisma.TransactionClient,
    userId: string,
    type: MembershipType,
    started: { id: string; startDate: Date; expiryDate: Date | null }
  ) {
    const candidates = await tx.memberMembership.findMany({
      where: {
        userId,
        status: MembershipStatus.ACTIVE,
        startDate: null,
        id: { not: started.id },
        membership: { type },
      },
      include: {
        membership: true,
        membershipPurchase: {
          select: {
            type: true,
            firstSessionId: true,
          },
        },
        bookings: {
          where: {
            bookingStatus: BookingStatus.CONFIRMED,
          },
          select: {
            bookingStatus: true,
            sessionId: true,
          },
          take: 1,
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    let previous = started;

    for (const next of candidates) {
      if (!this.isAwaitingFirstBooking(next)) {
        continue;
      }

      // A package with no time limit has no end date, so the
      // next one starts with it.
      const nextStartDate = previous.expiryDate ?? previous.startDate;

      const nextExpiryDate = this.calculateMembershipExpiry(
        nextStartDate,
        next.membership.duration,
        next.membership.period
      );

      // Same guard as the first activation: never overwrite dates
      // another request has already set.
      const queued = await tx.memberMembership.updateMany({
        where: { id: next.id, userId, startDate: null },
        data: {
          startDate: nextStartDate,
          expiryDate: nextExpiryDate,
        },
      });

      if (queued.count !== 1) {
        throw new Error(
          "Your membership was updated by another booking. Please try again."
        );
      }

      previous = {
        id: next.id,
        startDate: nextStartDate,
        expiryDate: nextExpiryDate,
      };
    }
  }

  /** Midnight UTC on the same calendar day. */
  private startOfUtcDay(date: Date) {
    return new Date(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate()
      )
    );
  }

  /**
   * Whether a membership's validity covers a session date.
   *
   * A queued renewal has a future startDate and only covers sessions
   * from that day. startDate is compared by calendar day, since
   * sessionDate is the session's day at UTC midnight and older rows
   * can store a time of day. A null startDate puts no start limit on
   * the row (legacy and admin rows). Rows awaiting their first
   * booking are picked separately, before this check.
   */
  private coversSessionDate(
    item: { startDate: Date | null; expiryDate: Date | null },
    sessionDate: Date
  ) {
    if (item.expiryDate && sessionDate > item.expiryDate) {
      return false;
    }

    if (
      item.startDate &&
      sessionDate < this.startOfUtcDay(item.startDate)
    ) {
      return false;
    }

    return true;
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

    // A membership may be purchased before the customer
    // selects a dated session. If a session is supplied,
    // validate it for either membership type.
    //
    // scheduleId is accepted here as a backward-compatible
    // request field, but its value must be a ClassSession.id.

    const classSessionId =
      data.classSessionId?.trim() ||
      data.scheduleId?.trim() ||
      undefined;

    let classSession = null;

    if (classSessionId) {
      classSession =
        await prisma.classSession.findUnique({
          where: {
            id: classSessionId,
          },

          include: {
            schedule: true,
          },
        });

      if (!classSession) {
        throw new Error(
          "Selected class session was not found."
        );
      }

      if (!classSession.schedule.isActive) {
        throw new Error(
          "This class schedule is no longer active."
        );
      }

      if (classSession.status !== "OPEN") {
        throw new Error(
          "This class session is no longer available."
        );
      }

      // -----------------------------------------------------
      // TOMORROW ONWARD
      // -----------------------------------------------------

    if (!this.isSessionAtLeastTwoHoursAhead(
  classSession.sessionDate,
  classSession.schedule.startTime
)) {
  throw new Error(
    "This session must start at least two hours from now."
  );
}

      // -----------------------------------------------------
      // CLASS MATCH
      // -----------------------------------------------------

      if (
        data.classId &&
        classSession.schedule.className.toLowerCase() !==
          data.classId.toLowerCase()
      ) {
        throw new Error(
          "The selected session does not belong to the selected class."
        );
      }
    }

    // -------------------------------------------------------
    // HEALTH DECLARATION
    // -------------------------------------------------------

    const healthDeclaration = data.healthDeclaration;

    if (
      healthDeclaration !== undefined &&
      healthDeclaration.accepted !== true
    ) {
      throw new Error(
        "You must accept the Health Declaration to continue."
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
    } = this.generateBookingFlowToken();

    // -------------------------------------------------------
    // CREATE BOOKING
    // -------------------------------------------------------

    const booking =
      await prisma.$transaction(
        async (tx) => {
          // Pending purchases do not reserve a session.
          // Lock the session and check its availability
          // again before creating this pending booking.

          if (classSession) {
            await tx.$queryRaw`
              SELECT id
              FROM "ClassSession"
              WHERE id = ${classSession.id}
              FOR UPDATE
            `;

            const availability =
              await this.assertSessionAvailable(
                tx,
                classSession.id,
                membership.type
              );

            if (data.classId) {
              if (
                availability.session.schedule.className.toLowerCase() !==
                data.classId.toLowerCase()
              ) {
                throw new Error(
                  "The selected session does not belong to the selected class."
                );
              }
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
                  classSession?.schedule.className ??
                  null,

                sessionId:
                  classSession?.id ??
                  null,

                // Store the recurring Schedule.id in this
                // database relation, not the session ID.
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
                  data.paymentMethod === "OFFLINE"
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
          // SAVE HEALTH DECLARATION IF ACCEPTED
          // -------------------------------------------------

          // Membership-first purchases can complete the
          // declaration later, before confirming a session.

          if (healthDeclaration?.accepted === true) {
            await tx.healthSafetyForm.create({
              data: {
                bookingId:
                  createdBooking.id,

                userId: null,

                accepted: true,

                declarationVersion:
                  this.HEALTH_DECLARATION_VERSION,

                notes:
                  healthDeclaration.notes?.trim() ||
                  null,

                acceptedAt:
                  new Date(),

                submittedAt:
                  new Date(),

                screeningAnswers: {},

                consent: [],
              },
            });
          }

          return createdBooking;
        }
      );

    // -------------------------------------------------------
    // OFFLINE
    // -------------------------------------------------------

    if (data.paymentMethod === "OFFLINE") {
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

    if (!booking.email) {
      throw new Error(
        "Email is required before initializing payment."
      );
    }

    const payment =
      await paymentService.initializeTransaction({
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

    if (!booking.email) {
  throw new Error(
    "Email is required before initializing payment."
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


  

async resumeBookingForUser(reference: string, userId: string) {
const booking = await prisma.booking.findUnique({
  where: { paymentReference: reference },
  include: {
    healthSafetyForm: true,
  },
});

  if (!booking) {
    throw new Error("Booking not found.");
  }

  if (booking.paymentStatus !== PaymentStatus.PAID) {
    throw new Error("Payment has not been completed for this booking.");
  }

  if (booking.userId && booking.userId !== userId) {
    throw new Error("This booking is already attached to another account.");
  }

  if (booking.userId === userId) {
    return {
      booking,
      alreadyAttached: true,
      bookingFlowToken: null,
    };
  }

  if (booking.bookingStatus !== BookingStatus.PENDING) {
    throw new Error("This booking can no longer be continued.");
  }

  const { token: bookingFlowToken, tokenHash } =
    this.generateBookingFlowToken();
const result = await prisma.booking.updateMany({
  where: {
    id: booking.id,
    userId: null,
    paymentStatus: PaymentStatus.PAID,
    bookingStatus: BookingStatus.PENDING,
    bookingFlowTokenHash: booking.bookingFlowTokenHash,
  },
  data: {
    bookingFlowTokenHash: tokenHash,
  },
});

  if (result.count !== 1) {
    throw new Error(
      "This booking has changed or is already being processed. Please try again."
    );
  }

  const updatedBooking = await prisma.booking.findUniqueOrThrow({
    where: { id: booking.id },
  });

  return {
    booking: updatedBooking,
    alreadyAttached: false,
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
  },
  userId?: string
) {
  let booking;

  if (userId) {
    // Authenticated recovery: the booking must belong to this user.
    booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { healthSafetyForm: true },
    });

    if (!booking || booking.userId !== userId) {
      throw new Error("This booking does not belong to your account.");
    }

    if (booking.paymentStatus !== PaymentStatus.PAID) {
      throw new Error("Payment has not been completed for this booking.");
    }
  } else {
    // Guest flow: use the original continuation token.
    booking = await this.getBookingByFlowToken(
      bookingId,
      bookingFlowToken
    );
  }

  if (booking.bookingStatus !== BookingStatus.PENDING) {
    throw new Error("This booking can no longer be changed.");
  }

  if (data.accepted !== true) {
    throw new Error(
      "You must accept the Health Declaration to continue."
    );
  }

  const now = new Date();

  return prisma.healthSafetyForm.upsert({
    where: { bookingId },
    create: {
      bookingId,
      userId: booking.userId ?? userId ?? null,
      accepted: true,
      declarationVersion: this.HEALTH_DECLARATION_VERSION,
      notes: data.notes?.trim() || null,
      acceptedAt: now,
      submittedAt: now,
      screeningAnswers: {},
      consent: [],
    },
    update: {
      userId: booking.userId ?? userId ?? null,
      accepted: true,
      declarationVersion: this.HEALTH_DECLARATION_VERSION,
      notes: data.notes?.trim() || null,
      acceptedAt: now,
      submittedAt: now,
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
  const booking = await this.getBookingByFlowToken(
    bookingId,
    bookingFlowToken
  );

  if (booking.userId && booking.userId !== userId) {
    throw new Error("This booking is already attached to another account.");
  }

  if (booking.paymentStatus !== PaymentStatus.PAID) {
    throw new Error("Payment has not been completed for this booking.");
  }

  if (booking.userId === userId) {
    return {
      booking,
      alreadyAttached: true,
    };
  }

  if (booking.bookingStatus !== BookingStatus.PENDING) {
    throw new Error("Only pending bookings can be attached to an account.");
  }

  const updatedBooking = await prisma.$transaction(async (tx) => {
    const result = await tx.booking.updateMany({
      where: {
        id: booking.id,
        userId: null,
        paymentStatus: PaymentStatus.PAID,
        bookingStatus: BookingStatus.PENDING,
        bookingFlowTokenHash: booking.bookingFlowTokenHash,
      },
      data: {
        userId,
        bookingFlowTokenHash: null,
      },
    });

    if (result.count !== 1) {
      throw new Error(
        "This booking has changed or has already been attached. Please try again."
      );
    }

    await tx.healthSafetyForm.updateMany({
      where: { bookingId: booking.id },
      data: { userId },
    });

    return tx.booking.findUniqueOrThrow({
      where: { id: booking.id },
      include: {
        membership: true,
        memberMembership: true,
        session: {
          include: { schedule: true },
        },
        healthSafetyForm: true,
      },
    });
  });

  return {
    booking: updatedBooking,
    alreadyAttached: false,
  };
}


  async getClassAvailability(
    classId: string,
    fromDate?: string,
    toDate?: string,
    requestedType: MembershipType = MembershipType.GROUP
  ) {
    if (!classId) {
      throw new Error("Class is required.");
    }

    if (
      requestedType !== MembershipType.GROUP &&
      requestedType !== MembershipType.PRIVATE
    ) {
      throw new Error("Membership type must be GROUP or PRIVATE.");
    }

const startDate = fromDate
  ? new Date(fromDate)
  : new Date();

startDate.setHours(0, 0, 0, 0);

    if (Number.isNaN(startDate.getTime())) {
      throw new Error("Invalid from date.");
    }

  

    const endDate = toDate
      ? new Date(toDate)
      : new Date(startDate);

    if (Number.isNaN(endDate.getTime())) {
      throw new Error("Invalid to date.");
    }

    if (toDate) {
      endDate.setHours(23, 59, 59, 999);
    } else {
      endDate.setDate(
        endDate.getDate() + this.AVAILABILITY_DAYS
      );
      endDate.setHours(23, 59, 59, 999);
    }

    if (endDate < startDate) {
      throw new Error(
        "The end date cannot be before the start date."
      );
    }

    const sessions = await prisma.classSession.findMany({
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
        bookings: {
          where: {
            bookingStatus: BookingStatus.CONFIRMED,
          },
          select: {
            membership: {
              select: {
                type: true,
              },
            },
          },
        },
      },
      orderBy: {
        sessionDate: "asc",
      },
    });

return sessions
.filter((session) =>
  this.isSessionAtLeastTwoHoursAhead(
    session.sessionDate,
    session.schedule.startTime
  )
)
  .map((session) => {
    const capacity = Math.min(
  5,
  session.capacity ?? session.schedule.capacity
);

      const groupBookedCount = session.bookings.filter(
        (booking) =>
          booking.membership.type === MembershipType.GROUP
      ).length;

      const privateBookedCount = session.bookings.filter(
        (booking) =>
          booking.membership.type === MembershipType.PRIVATE
      ).length;

      const bookedCount =
        groupBookedCount + privateBookedCount;

      const availableSlots =
        requestedType === MembershipType.PRIVATE
          ? bookedCount === 0
            ? 1
            : 0
          : privateBookedCount > 0
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
        capacity:
          requestedType === MembershipType.PRIVATE
            ? 1
            : capacity,
        bookedCount,
        groupBookedCount,
        privateBookedCount,
        availableSlots,
        isAvailable: availableSlots > 0,
        status: session.status,
        membershipType: requestedType,
      };
    });
  }

  async getSessionAvailability(
    sessionId: string,
    requestedType: MembershipType = MembershipType.GROUP
  ) {
    if (
      requestedType !== MembershipType.GROUP &&
      requestedType !== MembershipType.PRIVATE
    ) {
      throw new Error("Membership type must be GROUP or PRIVATE.");
    }

    const session = await prisma.classSession.findUnique({
      where: {
        id: sessionId,
      },
      include: {
        schedule: true,
        bookings: {
          where: {
            bookingStatus: BookingStatus.CONFIRMED,
          },
          select: {
            membership: {
              select: {
                type: true,
              },
            },
          },
        },
      },
    });

    if (!session) {
      throw new Error("Class session not found.");
    }

  if (!this.isSessionAtLeastTwoHoursAhead(
  session.sessionDate,
  session.schedule.startTime
)) {
  throw new Error(
    "This session must start at least two hours from now."
  );
}

    const groupBookedCount = session.bookings.filter(
      (booking) =>
        booking.membership.type === MembershipType.GROUP
    ).length;

    const privateBookedCount = session.bookings.filter(
      (booking) =>
        booking.membership.type === MembershipType.PRIVATE
    ).length;

    const bookedCount =
      groupBookedCount + privateBookedCount;

  const groupCapacity = Math.min(
  5,
  session.capacity ?? session.schedule.capacity
);

    const availableSlots =
      requestedType === MembershipType.PRIVATE
        ? bookedCount === 0
          ? 1
          : 0
        : privateBookedCount > 0
          ? 0
          : Math.max(groupCapacity - groupBookedCount, 0);

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
      capacity:
        requestedType === MembershipType.PRIVATE
          ? 1
          : groupCapacity,
      bookedCount,
      groupBookedCount,
      privateBookedCount,
      availableSlots,
      isAvailable:
        session.status === "OPEN" &&
        session.schedule.isActive &&
        availableSlots > 0,
      status: session.status,
      membershipType: requestedType,
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
    return this.confirmBookingFor(bookingId, userId);
  }

  /**
   * Admin offline payment confirmation: confirm the class the customer
   * selected at checkout, after the admin has confirmed their transfer
   * and the membership has been created.
   *
   * The customer usually has no account yet, so the booking belongs to
   * no one (userId null). This runs the same confirmation as
   * confirmBooking, for the booking's recorded owner: the same
   * transaction, row locks, session, capacity, two-hour, health
   * declaration and credit rules, and calendar event. A booking that is
   * already confirmed is returned unchanged.
   */
  async confirmOfflinePaidBooking(bookingId: string) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        userId: true,
        paymentMethod: true,
        paymentStatus: true,
      },
    });

    if (!booking) {
      throw new Error("Booking not found.");
    }

    if (booking.paymentMethod !== PaymentMethod.OFFLINE) {
      throw new Error("This booking is not an offline payment.");
    }

    if (booking.paymentStatus !== PaymentStatus.PAID) {
      throw new Error("The offline payment for this booking has not been confirmed.");
    }

    return this.confirmBookingFor(bookingId, booking.userId);
  }

  /**
   * Shared confirmation. `userId` is the owner the booking must have:
   * the logged-in member for confirmBooking, or the booking's own
   * owner (possibly none yet) for an admin-confirmed offline payment.
   */
  private async confirmBookingFor(
    bookingId: string,
    userId: string | null
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
    userId: string | null
  ) {
    // Set when another request had already confirmed this booking,
    // so this call neither changes it nor creates another calendar
    // event for it.
    let alreadyConfirmed = false;

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
            alreadyConfirmed = true;
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

       if (!this.isSessionAtLeastTwoHoursAhead(
  session.sessionDate,
  session.schedule.startTime
)) {
  throw new Error(
    "This session must start at least two hours from now."
  );
}

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

                // -------------------------------------------------
          // CHECK GROUP SESSION AVAILABILITY
          // -------------------------------------------------

          if (
            currentBooking.membership.type !==
            MembershipType.GROUP
          ) {
            throw new Error(
              "This booking does not have a Group membership."
            );
          }

          await this.assertSessionAvailable(
            tx,
            session.id,
            MembershipType.GROUP
          );

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
  bookingStatus: BookingStatus.CONFIRMED,
  bookingDate: session.sessionDate,
  preferredStartDate: session.sessionDate,
  memberMembershipId: memberMembership.id,
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
    //
    // Only the call that confirmed the booking creates the event, so a
    // repeated or concurrent confirmation never adds a second one.
    // =====================================================

    if (alreadyConfirmed) {
      return confirmedBooking;
    }

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
        if (    !confirmedBooking.fullName ||
    !confirmedBooking.email) {
  throw new Error(
    "Member name and email are required before creating the calendar event."
  );
}
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


// =========================================================
// CONFIRM PRIVATE BOOKING
// =========================================================

private async confirmPrivateBooking(
  bookingId: string,
  userId: string | null
) {
  // Set when another request had already confirmed this booking.
  let alreadyConfirmed = false;

  const confirmedBooking = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id
      FROM "Booking"
      WHERE id = ${bookingId}
      FOR UPDATE
    `;

    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      include: {
        membership: true,
        memberMembership: true,
        healthSafetyForm: true,
        session: { include: { schedule: true } },
      },
    });

    if (!booking) {
      throw new Error("Booking not found.");
    }

    if (booking.userId !== userId) {
      throw new Error("This booking does not belong to your account.");
    }

    // Idempotency: do not consume another credit on retry.
    if (booking.bookingStatus === BookingStatus.CONFIRMED) {
      alreadyConfirmed = true;
      return booking;
    }

    if (booking.paymentStatus !== PaymentStatus.PAID) {
      throw new Error("This booking has not been paid for.");
    }

    if (!booking.healthSafetyForm?.accepted) {
      throw new Error(
        "Please complete the Health Declaration before confirming your booking."
      );
    }

    if (booking.membership.type !== MembershipType.PRIVATE) {
      throw new Error("This booking does not have a Private membership.");
    }

    if (booking.sessionId) {
      await tx.$queryRaw`
        SELECT id
        FROM "ClassSession"
        WHERE id = ${booking.sessionId}
        FOR UPDATE
      `;

      await this.assertSessionAvailable(
        tx,
        booking.sessionId,
        MembershipType.PRIVATE
      );
    }

    const membershipStart = booking.preferredStartDate ?? new Date();

    const membershipExpiry = this.calculateMembershipExpiry(
      membershipStart,
      booking.membership.duration,
      booking.membership.period
    );

    const creditsTotal = this.getMembershipCredits(
      booking.membership.classLimit
    );

    const memberMembership = booking.memberMembership
      ? await tx.memberMembership.update({
          where: { id: booking.memberMembership.id },
          data: {
            userId,
            membershipId: booking.membershipId,
            status: MembershipStatus.ACTIVE,
            startDate: membershipStart,
            expiryDate: membershipExpiry,
            creditsTotal,
          },
        })
      : await tx.memberMembership.create({
          data: {
            userId,
            membershipId: booking.membershipId,
            status: MembershipStatus.ACTIVE,
            startDate: membershipStart,
            expiryDate: membershipExpiry,
            creditsTotal,
            creditsUsed: 0,
          },
        });

    if (!this.hasRemainingCredit(memberMembership)) {
      throw new Error("You do not have any remaining session credits.");
    }

    if (memberMembership.creditsTotal !== null) {
      await tx.memberMembership.update({
        where: { id: memberMembership.id },
        data: { creditsUsed: { increment: 1 } },
      });
    }

    return tx.booking.update({
      where: { id: booking.id },
      data: {
        bookingStatus: BookingStatus.CONFIRMED,
        bookingDate: membershipStart,
        preferredStartDate: membershipStart,
        memberMembershipId: memberMembership.id,
      },
      include: {
        membership: true,
        memberMembership: true,
        healthSafetyForm: true,
        session: { include: { schedule: true } },
      },
    });
  });

  // Create the tutor/member calendar event only after the booking commits.
  // Calendar failure must never roll back a confirmed private booking.
  // Only the call that confirmed the booking creates the event, so a
  // repeated or concurrent confirmation never adds a second one.
  if (
    !alreadyConfirmed &&
    confirmedBooking.sessionId &&
    !confirmedBooking.calendarEventId
  ) {
    try {
      const session = await prisma.classSession.findUnique({
        where: { id: confirmedBooking.sessionId },
        include: { schedule: true },
      });

      if (session) {
        if (!confirmedBooking.fullName || !confirmedBooking.email) {
          throw new Error(
            "Member name and email are required before creating the calendar event."
          );
        }

        const calendarEvent =
          await googleCalendarService.createBookingEvent({
            bookingId: confirmedBooking.id,
            bookingReference: confirmedBooking.paymentReference,
            memberName: confirmedBooking.fullName,
            memberEmail: confirmedBooking.email,
            className: session.schedule.className,
            tutorName: session.schedule.tutorName,
            sessionDate: session.sessionDate,
            startTime: session.schedule.startTime,
            endTime: session.schedule.endTime,
          });

        if (calendarEvent.eventId) {
          await prisma.booking.update({
            where: { id: confirmedBooking.id },
            data: {
              calendarEventId: calendarEvent.eventId,
              calendarEventUrl: calendarEvent.eventUrl,
            },
          });

          confirmedBooking.calendarEventId = calendarEvent.eventId;
          confirmedBooking.calendarEventUrl = calendarEvent.eventUrl;
        }

        console.log(
          `✅ Google Calendar event created for private booking ${confirmedBooking.id}`
        );
      }
    } catch (calendarError) {
      console.error(
        `⚠️ Google Calendar event creation failed for private booking ${confirmedBooking.id}:`,
        calendarError
      );
    }
  }

  return confirmedBooking;
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
  sessionId: string,
  healthDeclaration: {
    accepted: boolean;
    notes?: string;
  },
  bookingType: MembershipType
)
{
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

  if (
    bookingType !== MembershipType.GROUP &&
    bookingType !== MembershipType.PRIVATE
  ) {
    throw new Error("Membership type must be GROUP or PRIVATE.");
  }

if (healthDeclaration?.accepted !== true) {
  throw new Error(
    "You must accept the Health Declaration to continue."
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

   if (!this.isSessionAtLeastTwoHoursAhead(
  session.sessionDate,
  session.schedule.startTime
)) {
  throw new Error(
    "This session must start at least two hours from now."
  );
}

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
        // LOCK THE MEMBER
        // -----------------------------------------------------
        // Membership changes for one member (bookings, renewals,
        // upgrades) run one at a time. Without this, two requests
        // could read the same credits and both use them, or a booking
        // could use a credit that an upgrade is carrying over.
        // Lock order is always session, then member, so this can't
        // deadlock with purchase completion (purchase, then member).
        await tx.$queryRaw`
          SELECT id
          FROM "User"
          WHERE id = ${userId}
          FOR UPDATE
        `;

        // -----------------------------------------------------
        // FIND ACTIVE MEMBERSHIP
        // -----------------------------------------------------

        const now =
          new Date();

        // -----------------------------------------------------
        // FIND ELIGIBLE MEMBERSHIPS IN THE REQUESTED CREDIT POOL
        // -----------------------------------------------------
        // Keep each MemberMembership row separate for audit and
        // cancellation restoration. A booking consumes one row,
        // but the member can use credits from any active row of
        // the same membership type.
        const memberships =
          await tx.memberMembership.findMany({
            where: {
              userId,
              status: MembershipStatus.ACTIVE,
              membership: {
                type: bookingType,
              },
              OR: [
                { expiryDate: null },
                { expiryDate: { gt: now } },
              ],
            },
            include: {
              membership: true,
              membershipPurchase: {
                select: {
                  type: true,
                  firstSessionId: true,
                  previousMemberMembershipId: true,
                },
              },
              // Only needed to tell whether a row has already
              // had a confirmed booking.
              bookings: {
                where: {
                  bookingStatus: BookingStatus.CONFIRMED,
                },
                select: {
                  bookingStatus: true,
                  sessionId: true,
                },
                take: 1,
              },
            },
            orderBy: {
              expiryDate: "asc",
            },
          });

        // Prefer the finite membership that expires soonest;
        // keep unlimited/non-expiring records as the fallback.
        memberships.sort((a, b) => {
          if (a.expiryDate === null && b.expiryDate === null) return 0;
          if (a.expiryDate === null) return 1;
          if (b.expiryDate === null) return -1;
          return a.expiryDate.getTime() - b.expiryDate.getTime();
        });

        if (memberships.length === 0) {
          throw new Error(
            `You do not have an active ${bookingType.toLowerCase()} membership.`
          );
        }

        // A membership awaiting its first booking is used first,
        // so that booking starts it. The query above already
        // limits rows to this user and the requested type.
        //
        // The oldest awaiting row goes first. When unstarted
        // renewals are queued behind it, it is the head of that
        // chain, and starting it starts the renewals after it.
        const awaitingMembership = memberships
          .filter((item) =>
            this.isAwaitingFirstBooking(item) &&
            this.hasRemainingCredit(item)
          )
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];

        // Otherwise use the earliest-expiring record that both has
        // a remaining credit and whose validity covers the selected
        // session date. A queued renewal only covers sessions from
        // its start date, so the current membership is used until it
        // ends and the renewal's credits are not used early.
        const membership =
          awaitingMembership ??
          memberships.find((item) =>
            this.hasRemainingCredit(item) &&
            this.coversSessionDate(item, session.sessionDate)
          );

        if (!membership) {
          const hasCredit = memberships.some((item) =>
            this.hasRemainingCredit(item)
          );

          if (!hasCredit) {
            throw new Error(
              `You do not have any remaining ${bookingType.toLowerCase()} class credits.`
            );
          }

          const startsLater = memberships.find((item) =>
            this.hasRemainingCredit(item) &&
            item.startDate !== null &&
            session.sessionDate < this.startOfUtcDay(item.startDate)
          );

          if (startsLater?.startDate) {
            throw new Error(
              `Your next membership starts on ${startsLater.startDate
                .toISOString()
                .slice(0, 10)}. Please choose a session from that date.`
            );
          }

          throw new Error(
            "This session is outside your membership validity period."
          );
        }

        // -----------------------------------------------------
        // CHECK SESSION TYPE AND AVAILABILITY
        // -----------------------------------------------------
        if (membership.membership.type !== bookingType) {
          throw new Error(
            "The selected membership does not match this booking type."
          );
        }

        await this.assertSessionAvailable(
          tx,
          session.id,
          bookingType
        );
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
        // FIRST-BOOKING VALIDITY PERIOD
        // -----------------------------------------------------
        // A membership awaiting its first booking starts on the
        // date of this session, never the payment date. Work out
        // the dates before any write so an unsupported duration
        // rejects the booking without changing anything.
        const firstBookingStartDate = awaitingMembership
          ? session.sessionDate
          : null;

        const firstBookingExpiryDate = awaitingMembership
          ? await this.calculateFirstBookingExpiry(
              tx,
              userId,
              awaitingMembership,
              session.sessionDate
            )
          : null;

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

          
await tx.healthSafetyForm.create({
  data: {
    bookingId: createdBooking.id,
    userId,
    accepted: true,
    declarationVersion: this.HEALTH_DECLARATION_VERSION,
    notes: healthDeclaration.notes?.trim() || null,
    acceptedAt: new Date(),
    submittedAt: new Date(),
    screeningAnswers: {},
    consent: [],
  },
});

        // -----------------------------------------------------
        // CONSUME CREDIT
        // -----------------------------------------------------

        if (awaitingMembership) {
          // First booking for a membership-only purchase: its
          // validity starts on this session's date. Start it and
          // use the credit in one update on the same row.
          //
          // `startDate: null` in the filter means only one booking
          // can start the membership. A concurrent first booking
          // waits for the row lock, then matches nothing and rolls
          // back, instead of overwriting the start date.
          const activated = await tx.memberMembership.updateMany({
            where: {
              id: membership.id,
              userId,
              startDate: null,
            },

            data: {
              startDate: firstBookingStartDate,
              expiryDate: firstBookingExpiryDate,

              ...(membership.creditsTotal !== null
                ? {
                    creditsUsed: {
                      increment: 1,
                    },
                  }
                : {}),
            },
          });

          if (activated.count !== 1) {
            throw new Error(
              "Your membership was updated by another booking. Please try again."
            );
          }

          // Other packages of this type bought while this one was
          // unstarted (renewals, or further membership-only
          // purchases) follow it, each adding its full duration.
          await this.startQueuedMemberships(tx, userId, bookingType, {
            id: membership.id,
            startDate: session.sessionDate,
            expiryDate: firstBookingExpiryDate,
          });
        } else if (
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
      if (!booking.fullName || !booking.email) {
  throw new Error(
    "Member name and email are required before creating the calendar event."
  );
}
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

async getMembershipCreditSummary(userId: string) {
  const now = new Date();

  const memberships = await prisma.memberMembership.findMany({
    where: {
      userId,
      status: MembershipStatus.ACTIVE,
      OR: [
        { expiryDate: null },
        { expiryDate: { gt: now } },
      ],
    },
    include: {
      membership: true,
      membershipPurchase: true,
      bookings: {
        where: { bookingStatus: BookingStatus.CONFIRMED },
        select: {
          id: true,
          sessionId: true,
          bookingStatus: true,
        },
      },
    },
    orderBy: {
      expiryDate: "asc",
    },
  });

  if (memberships.length === 0) return null;

  // Finite expiries are consumed first; non-expiring records last.
  memberships.sort((a, b) => {
    if (a.expiryDate === null && b.expiryDate === null) return 0;
    if (a.expiryDate === null) return 1;
    if (b.expiryDate === null) return -1;
    return a.expiryDate.getTime() - b.expiryDate.getTime();
  });

  /*
   * Current vs queued.
   *
   * A queued membership (an early renewal, or a package waiting behind
   * another) has a start date after today. Its credits are not usable
   * now, so they are reported separately and never counted in the
   * current credit fields. They can still pay for sessions dated on or
   * after their start date (see bookMemberSession), so they are shown
   * rather than hidden.
   *
   * Everything else is current: started on or before today, or not
   * started yet (awaiting its first booking, which starts it).
   */
  const today = this.startOfUtcDay(now);

  const isQueued = (row: { startDate: Date | null }) =>
    row.startDate !== null && this.startOfUtcDay(row.startDate) > today;

  const summariseCredits = (
    rows: { creditsTotal: number | null; creditsUsed: number }[]
  ) => {
    const unlimited = rows.some((item) => item.creditsTotal === null);

    return {
      unlimited,
      creditsTotal: unlimited
        ? null
        : rows.reduce((total, item) => total + (item.creditsTotal ?? 0), 0),
      creditsUsed: rows.reduce((total, item) => total + item.creditsUsed, 0),
      remainingCredits: unlimited
        ? null
        : rows.reduce(
            (total, item) =>
              total + Math.max((item.creditsTotal ?? 0) - item.creditsUsed, 0),
            0
          ),
    };
  };

  const earliestStart = (rows: { startDate: Date | null }[]) => {
    const dates = rows
      .map((item) => item.startDate)
      .filter((date): date is Date => date !== null);

    return dates.length
      ? new Date(Math.min(...dates.map((date) => date.getTime())))
      : null;
  };

  // The end of the rows' validity: null if any row has no expiry.
  const latestExpiry = (rows: { expiryDate: Date | null }[]) => {
    if (rows.length === 0 || rows.some((row) => row.expiryDate === null)) {
      return null;
    }

    return new Date(
      Math.max(...rows.map((row) => (row.expiryDate as Date).getTime()))
    );
  };

  const buildPool = (type: MembershipType) => {
    const rows = memberships.filter(
      (item) => item.membership.type === type
    );
    if (rows.length === 0) return null;

    const currentRows = rows.filter((row) => !isQueued(row));
    const queuedRows = rows.filter(isQueued);
    const current = summariseCredits(currentRows);

    const firstRow = currentRows[0] ?? rows[0];
    const firstBookingConfirmed = rows.some((row) => {
      const purchase = row.membershipPurchase;
      return row.bookings.some(
        (booking) =>
          booking.bookingStatus === BookingStatus.CONFIRMED &&
          (!purchase?.firstSessionId ||
            booking.sessionId === purchase.firstSessionId)
      );
    });
    const hasFirstSession =
      rows.some((row) => Boolean(row.membershipPurchase?.firstSessionId)) ||
      firstBookingConfirmed;

    return {
      type,

      // Usable now.
      memberMembershipIds: currentRows.map((row) => row.id),
      membership: firstRow.membership,
      creditsTotal: current.creditsTotal,
      creditsUsed: current.creditsUsed,
      remainingCredits: current.remainingCredits,
      unlimited: current.unlimited,
      startDate: earliestStart(currentRows),
      expiryDate: latestExpiry(currentRows),

      // Starts later. Not available for sessions before its start date.
      queued: queuedRows.length
        ? {
            memberMembershipIds: queuedRows.map((row) => row.id),
            ...summariseCredits(queuedRows),
            startDate: earliestStart(queuedRows),
            expiryDate: latestExpiry(queuedRows),
          }
        : null,

      // End of everything the member holds for this type, queued
      // memberships included.
      validUntil: latestExpiry(rows),

      status: MembershipStatus.ACTIVE,
      hasFirstSession,
      firstBookingConfirmed,
      // Same rule bookMemberSession uses to pick the row that the
      // first booking starts.
      requiresInitialBooking: rows.some((row) =>
        this.isAwaitingFirstBooking(row)
      ),
    };
  };

  const group = buildPool(MembershipType.GROUP);
  const privatePool = buildPool(MembershipType.PRIVATE);
  const primary = group ?? privatePool;
  const combinedUnlimited = Boolean(group?.unlimited || privatePool?.unlimited);
  const combinedCreditsTotal = combinedUnlimited
    ? null
    : (group?.creditsTotal ?? 0) + (privatePool?.creditsTotal ?? 0);
  const combinedCreditsUsed =
    (group?.creditsUsed ?? 0) + (privatePool?.creditsUsed ?? 0);

  const queuedPools = [group?.queued, privatePool?.queued].filter(
    (pool): pool is NonNullable<typeof pool> => Boolean(pool)
  );
  const queuedUnlimited = queuedPools.some((pool) => pool.unlimited);

  return {
    // Legacy top-level fields remain for existing clients. Credit
    // fields count only memberships usable now.
    memberMembershipId: primary?.memberMembershipIds[0] ?? null,
    memberMembershipIds: [
      ...(group?.memberMembershipIds ?? []),
      ...(privatePool?.memberMembershipIds ?? []),
    ],
    membership: primary?.membership ?? null,
    creditsTotal: combinedCreditsTotal,
    creditsUsed: combinedCreditsUsed,
    remainingCredits: combinedUnlimited
      ? null
      : (group?.remainingCredits ?? 0) +
        (privatePool?.remainingCredits ?? 0),
    unlimited: combinedUnlimited,
    startDate: primary?.startDate ?? null,
    expiryDate: primary?.expiryDate ?? null,

    // Credits of queued memberships (null when one is unlimited).
    queuedCredits: queuedUnlimited
      ? null
      : queuedPools.reduce(
          (total, pool) => total + (pool.remainingCredits ?? 0),
          0
        ),
    validUntil: primary?.validUntil ?? null,

    status: MembershipStatus.ACTIVE,
    hasFirstSession: Boolean(group?.hasFirstSession || privatePool?.hasFirstSession),
    firstBookingConfirmed: Boolean(
      group?.firstBookingConfirmed || privatePool?.firstBookingConfirmed
    ),
    requiresInitialBooking: Boolean(
      group?.requiresInitialBooking || privatePool?.requiresInitialBooking
    ),
    creditPools: {
      GROUP: group,
      PRIVATE: privatePool,
    },
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
 * - Finite credits are restored to the exact membership row used.
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

if (
  !this.isSessionAtLeastTwoHoursAhead(
    booking.session.sessionDate,
    booking.session.schedule.startTime
  )
) {
  throw new Error(
    "Bookings can only be cancelled at least two hours before the session starts."
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
 * Restore one credit.
 *
 * If the booking belongs to an old membership that was
 * upgraded, restore the credit to the active upgraded
 * membership instead.
 */
let creditRestored = false;

const originalMembership = booking.memberMembership;

// Restore the credit to the exact MemberMembership row that
// funded this booking. Never redirect it to a newer purchase.
if (
  originalMembership &&
  originalMembership.creditsTotal !== null &&
  originalMembership.creditsUsed > 0
) {
  const restored = await tx.memberMembership.updateMany({
    where: {
      id: originalMembership.id,
      userId,
      creditsUsed: { gt: 0 },
      creditsTotal: { not: null },
    },
    data: {
      creditsUsed: { decrement: 1 },
    },
  });

  creditRestored = restored.count === 1;
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

  /**
   * Creates and confirms the first class booking included
   * with a paid membership purchase.
   *
   * The purchase payment has already been completed, so this
   * booking must not initialize or charge another payment.
   *
   * The deterministic reference makes retries idempotent.
   */
  async createMembershipFirstBooking(data: {
    purchaseReference: string;
    userId: string;
    membershipId: string;
    firstSessionId: string;
    fullName: string;
    email: string;
    phone: string;
    healthDeclarationNotes?: string | null;
  }) {
    const {
      purchaseReference,
      userId,
      membershipId,
      firstSessionId,
      fullName,
      email,
      phone,
      healthDeclarationNotes,
    } = data;

    if (!userId || !purchaseReference || !firstSessionId) {
      throw new Error(
        "The membership purchase, account and first session are required."
      );
    }

    if (!fullName?.trim() || !email?.trim() || !phone?.trim()) {
      throw new Error(
        "Member name, email and phone are required to create the first booking."
      );
    }

    // A stable reference prevents duplicate first bookings
    // Find the exact membership record created for this purchase.
const purchase = await prisma.membershipPurchase.findUnique({
  where: {
    paymentReference: purchaseReference,
  },
  select: {
    id: true,
    healthDeclarationAccepted: true,
  },
});

if (!purchase) {
  throw new Error("Membership purchase not found.");
}

const memberMembership = await prisma.memberMembership.findFirst({
  where: {
    membershipPurchaseId: purchase.id,
    userId,
    membershipId,
  },
});

if (!memberMembership) {
  throw new Error(
    "The membership record for this purchase could not be found."
  );
}
    // if payment verification or account registration is retried.
    const bookingReference = `${purchaseReference}-FIRST-BOOKING`;

    const existingBooking = await prisma.booking.findUnique({
      where: {
        paymentReference: bookingReference,
      },
    });

    if (existingBooking) {
      if (existingBooking.userId !== userId) {
        throw new Error(
          "This first booking is already attached to another account."
        );
      }

      if (existingBooking.bookingStatus === BookingStatus.CONFIRMED) {
        return existingBooking;
      }
    }

    // The checkout's health declaration covers this first class.
    // Without it the class can't be booked; the membership itself is
    // unaffected.
    if (!purchase.healthDeclarationAccepted) {
      throw new Error(
        "The health and safety declaration must be accepted before the first class can be booked."
      );
    }

    // Once another class has started this membership, confirming the
    // original first class now would move its validity to that class's
    // date. It has to be booked as a normal class instead.
    const otherConfirmedBooking = await prisma.booking.findFirst({
      where: {
        memberMembershipId: memberMembership.id,
        bookingStatus: BookingStatus.CONFIRMED,
        sessionId: { not: null },
        paymentReference: { not: bookingReference },
      },
      select: { id: true },
    });

    if (otherConfirmedBooking) {
      throw new Error(
        "The membership has already started from another booking, so the original first class can't be booked as its first class. Book it as a normal class instead."
      );
    }

    const [membership, session] = await Promise.all([
      prisma.membership.findUnique({
        where: { id: membershipId },
      }),
      prisma.classSession.findUnique({
        where: { id: firstSessionId },
        include: {
          schedule: true,
        },
      }),
    ]);

    if (!membership || !membership.isActive) {
      throw new Error("The selected membership is no longer available.");
    }

    if (!session) {
      throw new Error("The selected first class session was not found.");
    }

    if (
      session.status !== "OPEN" ||
      !session.schedule.isActive
    ) {
      throw new Error("The selected first class session is no longer available.");
    }

    if (
      !this.isSessionAtLeastTwoHoursAhead(
        session.sessionDate,
        session.schedule.startTime
      )
    ) {
      throw new Error(
        "The selected session must start at least two hours from now."
      );
    }

    // Create the booking only once. If a previous attempt created
    // it but failed during confirmation, reuse it on the retry.
    const booking = existingBooking
      ? await prisma.booking.update({
          where: { id: existingBooking.id },
        data: {
  userId,
  membershipId: membership.id,
  memberMembershipId: memberMembership.id,
  paymentStatus: PaymentStatus.PAID,
},
        })
      : await prisma.booking.create({
          data: {
            fullName: fullName.trim(),
            email: email.trim().toLowerCase(),
            phone: phone.trim(),
            userId,

            classId: session.schedule.className,
            sessionId: session.id,
            scheduleId: session.scheduleId,

            bookingDate: session.sessionDate,
            preferredStartDate: session.sessionDate,

            membershipId: membership.id,
            memberMembershipId: memberMembership.id,

            // The membership purchase already paid for this.
            // Do not charge the customer again for this booking.
            amount: 0,

            paymentMethod: PaymentMethod.OFFLINE,
            paymentReference: bookingReference,
            paymentStatus: PaymentStatus.PAID,
            bookingStatus: BookingStatus.PENDING,
          },
        });

    // The membership checkout already captured the declaration.
    // Persist it against the booking so confirmBooking() can use
    // the existing health declaration safeguard.
    await prisma.healthSafetyForm.upsert({
      where: {
        bookingId: booking.id,
      },
      create: {
        bookingId: booking.id,
        userId,
        accepted: true,
        declarationVersion: this.HEALTH_DECLARATION_VERSION,
        notes: healthDeclarationNotes?.trim() || null,
        acceptedAt: new Date(),
        submittedAt: new Date(),
        screeningAnswers: {},
        consent: [],
      },
      update: {
        userId,
        accepted: true,
        declarationVersion: this.HEALTH_DECLARATION_VERSION,
        notes: healthDeclarationNotes?.trim() || null,
        acceptedAt: new Date(),
        submittedAt: new Date(),
      },
    });

    // Reuse the existing confirmation flow. This performs the
    // capacity checks, membership credit deduction and calendar
    // event creation. It is safe to retry after confirmation.
    return this.confirmBooking(booking.id, userId);
  }

}

export default new BookingService();