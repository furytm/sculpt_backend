import crypto from "crypto";
import bcrypt from "bcrypt";
import {
  AuthProvider,
  MembershipStatus,
  MembershipType,
  UserRole,
} from "@prisma/client";
import prisma from "../config/prisma.js";
import { generateMembershipNumber } from "../utils/membership-number.js";
import bookingService from "../booking/booking.service.js";

import {
  generateAccessToken,
  generateRefreshToken,
} from "../utils/jwt.js";

import {
  CompleteActivationDto,
  VerifyActivationDto,
} from "./membership-activation.types.js";

const FRONTEND_URL =
  process.env.FRONTEND_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "http://localhost:3000";

const ACTIVATION_EXPIRY_DAYS = 7;

function generateActivationToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function hashActivationToken(token: string): string {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}

// function generateMembershipNumber(): string {
//   const year = new Date().getFullYear();

//   const randomNumber = crypto.randomInt(100000, 999999);

//   return `SL-${year}-${randomNumber}`;
// }

async function sendActivationEmail({
  email,
  fullName,
  membershipName,
  membershipNumber,
  activationToken,
  amount,
}: {
  email: string;
  fullName: string;
  membershipName: string;
  membershipNumber: string;
  activationToken: string;
  amount: number;
}) {
  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.EMAIL_FROM;

  if (!resendApiKey) {
    throw new Error("RESEND_API_KEY is not configured.");
  }

  if (!fromEmail) {
    throw new Error("EMAIL_FROM is not configured.");
  }

  const activationUrl =
    `${FRONTEND_URL}/activate` +
    `?membership=${encodeURIComponent(membershipNumber)}` +
    `&token=${encodeURIComponent(activationToken)}`;

  const resendResponse = await fetch(
    "https://api.resend.com/emails",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [email],
        subject: "Your Sculpt LAB Membership Is Ready",
        html: `
          <!DOCTYPE html>
          <html>
            <body
              style="
                margin:0;
                padding:0;
                background:#f7f5f1;
                font-family:Arial,sans-serif;
                color:#222;
              "
            >
              <div
                style="
                  max-width:600px;
                  margin:40px auto;
                  background:#ffffff;
                  padding:40px;
                  border-radius:12px;
                "
              >
                <h1
                  style="
                    margin:0 0 24px;
                    font-size:28px;
                  "
                >
                  Welcome to Sculpt LAB
                </h1>

                <p
                  style="
                    font-size:16px;
                    line-height:1.6;
                  "
                >
                  Hi ${escapeHtml(fullName)},
                </p>

                <p
                  style="
                    font-size:16px;
                    line-height:1.6;
                  "
                >
                  Your payment of
                  <strong>₦${amount.toLocaleString()}</strong>
                  for your
                  <strong>${escapeHtml(membershipName)}</strong>
                  has been confirmed.
                </p>

                <div
                  style="
                    margin:28px 0;
                    padding:20px;
                    background:#f7f5f1;
                    border-radius:8px;
                  "
                >
                  <p
                    style="
                      margin:0 0 8px;
                      font-size:13px;
                      color:#777;
                    "
                  >
                    MEMBERSHIP NUMBER
                  </p>

                  <p
                    style="
                      margin:0;
                      font-size:24px;
                      font-weight:bold;
                    "
                  >
                    ${escapeHtml(membershipNumber)}
                  </p>
                </div>

                <p
                  style="
                    font-size:16px;
                    line-height:1.6;
                  "
                >
                  Your membership is ready to be activated.
                  Click the button below to create your Sculpt LAB
                  account and link your membership.
                </p>

                <div style="margin:32px 0;">
                  <a
                    href="${activationUrl}"
                    style="
                      display:inline-block;
                      padding:14px 24px;
                      background:#222;
                      color:#fff;
                      text-decoration:none;
                      border-radius:6px;
                      font-weight:bold;
                    "
                  >
                    Activate My Membership
                  </a>
                </div>

                <p
                  style="
                    font-size:14px;
                    line-height:1.6;
                    color:#666;
                  "
                >
                  Your activation link is valid for
                  ${ACTIVATION_EXPIRY_DAYS} days.
                </p>

                <p
                  style="
                    font-size:14px;
                    line-height:1.6;
                    color:#666;
                  "
                >
                  If you did not make this payment, please contact
                  Sculpt LAB.
                </p>

                <p
                  style="
                    margin-top:32px;
                    font-size:16px;
                  "
                >
                  Welcome to Sculpt LAB.
                </p>
              </div>
            </body>
          </html>
        `,
      }),
    }
  );

  if (!resendResponse.ok) {
    const errorText = await resendResponse.text();

    console.error("Resend Error:", errorText);

    throw new Error("Failed to send activation email.");
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

class MembershipActivationService {
async createActivationForBooking(
  bookingId: string,
  remainingCredits?: number
) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        membership: true,
        memberMembership: true,
        membershipActivation: true,
        session: true,
      },
    });

    if (!booking) {
      throw new Error("Booking not found.");
    }

    if (booking.paymentStatus !== "PAID") {
      throw new Error("Payment must be confirmed before activation.");
    }

    if (booking.paymentMethod !== "OFFLINE") {
      throw new Error(
        "Activation is only required for offline payments."
      );
    }

    if (booking.membershipActivation) {
      throw new Error(
        "An activation has already been created for this booking."
      );
    }

    let memberMembership = booking.memberMembership;

    /*
     * Validity starts on the first booked session, never the
     * approval date. A confirmed booking with a session (or a booked
     * date) starts the membership on that date.
     *
     * Otherwise the dates stay null:
     * - an admin onboarding an offline member (no session): the
     *   membership waits for its first booked session
     *   (BookingService.bookMemberSession starts it);
     * - an offline payment whose selected class is still to be
     *   confirmed: confirming it sets the dates, and if it can't be
     *   confirmed the membership waits instead of starting on a class
     *   the member won't attend.
     *
     * The expiry uses the same duration rules as every other path.
     */
    const startDate =
      booking.bookingStatus === "CONFIRMED"
        ? booking.session?.sessionDate ??
          booking.bookingDate ??
          booking.preferredStartDate ??
          null
        : null;

    const expiryDate = startDate
      ? bookingService.calculateMembershipExpiry(
          startDate,
          booking.membership.duration,
          booking.membership.period
        )
      : null;

 
if (!memberMembership) {
  const classLimit = booking.membership.classLimit;

  const creditsUsed =
    classLimit === null || remainingCredits === undefined
      ? 0
      : classLimit - remainingCredits;

  memberMembership = await prisma.memberMembership.create({
    data: {
      userId: booking.userId ?? null,
      membershipId: booking.membershipId,
      status: MembershipStatus.ACTIVE,
      startDate,
      expiryDate,
      creditsTotal: classLimit,
      creditsUsed,
    },
  });
}

await prisma.booking.update({
  where: { id: booking.id },
  data: {
    memberMembershipId: memberMembership.id,
  },
});
    const activationToken = generateActivationToken();
    const tokenHash = hashActivationToken(activationToken);
let membershipNumber = generateMembershipNumber();

while (
  (await prisma.membershipActivation.findUnique({
    where: { membershipNumber },
  })) ||
  (await prisma.memberMembership.findFirst({
    where: { membershipNumber },
  }))
) {
  membershipNumber = generateMembershipNumber();
}

    const expiresAt = new Date();

    expiresAt.setDate(
      expiresAt.getDate() + ACTIVATION_EXPIRY_DAYS
    );

    const activation =
      await prisma.membershipActivation.create({
        data: {
          bookingId: booking.id,
          memberMembershipId: memberMembership.id,
          membershipNumber,
          tokenHash,
          expiresAt,
        },
      });
      await prisma.memberMembership.update({
  where: {
    id: memberMembership.id,
  },
  data: {
    membershipNumber,
  },
});

    try {
      /*
       * If the admin/customer supplied an email,
       * send the activation email.
       *
       * If there is no email, the activation is still created.
       * The admin onboarding flow can return the activation link
       * so the admin can send it manually.
       */
      if (booking.email) {
        await sendActivationEmail({
          email: booking.email,
          fullName: booking.fullName || "Sculpt LAB Member",
          membershipName: booking.membership.name,
          membershipNumber,
          activationToken,
          amount: booking.amount,
        });
      }
    } catch (error) {
      await prisma.membershipActivation.delete({
        where: {
          id: activation.id,
        },
      });

      if (!booking.memberMembership) {
        await prisma.memberMembership.delete({
          where: {
            id: memberMembership.id,
          },
        });
      }

      throw error;
    }

    const activationUrl =
      `${FRONTEND_URL}/activate` +
      `?membership=${encodeURIComponent(membershipNumber)}` +
      `&token=${encodeURIComponent(activationToken)}`;

    return {
      bookingId: booking.id,
      paymentReference: booking.paymentReference,
      membershipNumber,
      email: booking.email,
      phone: booking.phone,
      fullName: booking.fullName,
      activationUrl,
      emailSent: Boolean(booking.email),
    };
  }

async verifyActivation(data: VerifyActivationDto) {
  const activation =
    await prisma.membershipActivation.findUnique({
      where: {
        membershipNumber: data.membershipNumber,
      },
      include: {
        booking: {
          include: {
            membership: true,
          },
        },
        membershipPurchase: {
          include: {
            membership: true,
          },
        },
        memberMembership: true,
      },
    });

  if (!activation) {
    throw new Error("Invalid membership number.");
  }

  if (activation.usedAt) {
    throw new Error("This activation has already been used.");
  }

  if (activation.expiresAt < new Date()) {
    throw new Error("This activation link has expired.");
  }

  const tokenHash = hashActivationToken(
    data.activationToken
  );

  if (tokenHash !== activation.tokenHash) {
    throw new Error("Invalid activation token.");
  }

  // An activation must belong to exactly one source.
  const booking = activation.booking;
  const purchase = activation.membershipPurchase;

  if (Boolean(booking) === Boolean(purchase)) {
    throw new Error(
      "Invalid activation record. Please contact Sculpt LAB."
    );
  }

  const source = booking ?? purchase!;

  return {
    valid: true,
    membershipNumber: activation.membershipNumber,
    email: source.email,
    fullName: source.fullName,
    phone: source.phone,
    membership: source.membership,
  };
}

/**
 * Activate a paid offline membership purchase.
 *
 * The activation (and its email) never depends on the selected first
 * class. The order is:
 *   1. validate the purchase (OFFLINE, PAID);
 *   2. create or reuse the account (purchases with a first class) and
 *      attach the purchase to it;
 *   3. create or reuse the membership, with no dates;
 *   4. create the activation and send its email, or reuse an existing
 *      activation without emailing again;
 *   5. then try the selected first class through
 *      BookingService.createMembershipFirstBooking.
 *
 * If the class can't be booked, nothing is rolled back: the payment,
 * membership and activation stay, no credit is used, the dates stay
 * null, and the purchase keeps its first-session details so an admin
 * can retry (retryFirstClassBooking). The result reports the class
 * separately.
 *
 * Safe to call again for the same purchase: it reuses the account,
 * membership and activation, and only retries the class.
 */
async createActivationForPurchase(purchaseId: string) {
  const purchase = await prisma.membershipPurchase.findUnique({
    where: { id: purchaseId },
    include: {
      membership: true,
      memberMembership: true,
      membershipActivation: true,
    },
  });

  if (!purchase) {
    throw new Error("Membership purchase not found.");
  }

  if (purchase.paymentMethod !== "OFFLINE") {
    throw new Error("This purchase is not an offline payment.");
  }

  if (purchase.paymentStatus !== "PAID") {
    throw new Error("Payment must be confirmed before activation.");
  }

  let memberMembership = purchase.memberMembership;
  let userId = purchase.userId;

  // A purchase with a selected first session needs a user account
  // because the first booking must be attached to that account.
  if (purchase.firstSessionId) {
    const normalizedEmail = purchase.email.trim().toLowerCase();

    // Reuse an existing account where possible.
    let user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    // Create an account without a password if one doesn't exist.
    // The member will set their password through the activation flow.
    if (!user) {
      user = await prisma.user.create({
        data: {
          fullName: purchase.fullName?.trim() || "Sculpt LAB Member",
          email: normalizedEmail,
          phone: purchase.phone || null,
          provider: AuthProvider.LOCAL,
          role: UserRole.MEMBER,
        },
      });
    }

    userId = user.id;

    // Attach the purchase to the account.
    if (purchase.userId !== userId) {
      await prisma.membershipPurchase.update({
        where: { id: purchase.id },
        data: { userId },
      });
    }
  }

  // Create the membership record if it doesn't exist. Its dates stay
  // null: the first confirmed class (now or later) starts it.
  if (!memberMembership) {
    memberMembership = await prisma.memberMembership.create({
      data: {
        userId: userId ?? null,
        membershipId: purchase.membershipId,
        membershipPurchaseId: purchase.id,
        status: MembershipStatus.ACTIVE,
        startDate: null,
        expiryDate: null,
        creditsTotal: purchase.membership.classLimit,
        creditsUsed: 0,
      },
    });
  } else if (userId && memberMembership.userId !== userId) {
    memberMembership = await prisma.memberMembership.update({
      where: { id: memberMembership.id },
      data: { userId },
    });
  }

  // ---------------------------------------------------------------
  // ACTIVATION (before, and independent of, the first class)
  // ---------------------------------------------------------------

  let membershipNumber: string;
  let activationUrl: string | null = null;
  let activationStatus: "CREATED" | "EXISTING";
  let activationEmail: "SENT" | "FAILED" | "NOT_RESENT";
  let emailSent = false;

  if (purchase.membershipActivation) {
    // Reuse it. No new number, record or email; the raw token isn't
    // stored, so no link is returned. A lost or failed email is
    // re-sent through resendActivationForEmail.
    membershipNumber = purchase.membershipActivation.membershipNumber;
    activationStatus = "EXISTING";
    activationEmail = "NOT_RESENT";

    if (memberMembership.membershipNumber !== membershipNumber) {
      await prisma.memberMembership.update({
        where: { id: memberMembership.id },
        data: { membershipNumber },
      });
    }
  } else {
    // Generate activation credentials.
    const activationToken = generateActivationToken();
    const tokenHash = hashActivationToken(activationToken);

    membershipNumber = generateMembershipNumber();

    while (
      (await prisma.membershipActivation.findUnique({
        where: { membershipNumber },
      })) ||
      (await prisma.memberMembership.findFirst({
        where: { membershipNumber },
      }))
    ) {
      membershipNumber = generateMembershipNumber();
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + ACTIVATION_EXPIRY_DAYS);

    // bookingId is intentionally omitted:
    // this activation belongs to the membership purchase.
    await prisma.membershipActivation.create({
      data: {
        membershipPurchaseId: purchase.id,
        memberMembershipId: memberMembership.id,
        membershipNumber,
        tokenHash,
        expiresAt,
      },
    });

    await prisma.memberMembership.update({
      where: { id: memberMembership.id },
      data: { membershipNumber },
    });

    activationUrl = `${FRONTEND_URL}/activate?membership=${encodeURIComponent(
      membershipNumber
    )}&token=${encodeURIComponent(activationToken)}`;

    activationStatus = "CREATED";

    try {
      await sendActivationEmail({
        email: purchase.email,
        fullName: purchase.fullName || "Sculpt LAB Member",
        membershipName: purchase.membership.name,
        membershipNumber,
        activationToken,
        amount: purchase.amount,
      });

      emailSent = true;
    } catch (error) {
      console.error("Offline purchase activation email failed:", error);
    }

    activationEmail = emailSent ? "SENT" : "FAILED";
  }

  // ---------------------------------------------------------------
  // FIRST CLASS (after activation; its failure is only reported)
  // ---------------------------------------------------------------

  const firstClass =
    purchase.firstSessionId && userId
      ? await this.attemptFirstClassBooking(purchase, userId)
      : { status: "NOT_SELECTED" as const };

  return {
    purchaseId: purchase.id,
    paymentReference: purchase.paymentReference,
    membershipNumber,
    email: purchase.email,
    phone: purchase.phone,
    fullName: purchase.fullName,
    activationUrl,
    emailSent,
    activationStatus,
    activationEmail,
    firstClass,
  };
}

/**
 * Admin: retry the selected first class of a paid offline membership
 * purchase whose first class couldn't be booked when it was activated.
 *
 * Only re-runs BookingService.createMembershipFirstBooking with the
 * purchase's own reference and saved details, which reuses its
 * existing first booking. It never confirms or charges the payment,
 * and never creates a purchase, account, membership or activation. An
 * already-confirmed first class is returned unchanged.
 */
async retryFirstClassBooking(purchaseId: string) {
  const purchase = await prisma.membershipPurchase.findUnique({
    where: { id: purchaseId },
    include: {
      memberMembership: true,
      membershipActivation: true,
    },
  });

  if (!purchase) {
    throw new Error("Membership purchase not found.");
  }

  if (purchase.paymentMethod !== "OFFLINE") {
    throw new Error("This purchase is not an offline payment.");
  }

  if (purchase.paymentStatus !== "PAID") {
    throw new Error("This purchase's payment has not been confirmed yet.");
  }

  if (!purchase.firstSessionId) {
    throw new Error("This purchase has no selected first class to book.");
  }

  if (!purchase.userId) {
    throw new Error("This purchase is not linked to a customer account.");
  }

  if (
    !purchase.memberMembership ||
    purchase.memberMembership.userId !== purchase.userId
  ) {
    throw new Error(
      "This purchase's membership is not linked to the customer's account."
    );
  }

  if (!purchase.membershipActivation) {
    throw new Error(
      "This purchase has no activation yet. Confirm the payment first."
    );
  }

  return {
    purchaseId: purchase.id,
    paymentReference: purchase.paymentReference,
    firstClass: await this.attemptFirstClassBooking(purchase, purchase.userId),
  };
}

/**
 * Book and confirm the purchase's selected first class through the
 * existing BookingService.createMembershipFirstBooking, which does all
 * the validation, the membership dates, the credit and the calendar
 * event. A failure is returned as NOT_CONFIRMED, never thrown.
 */
private async attemptFirstClassBooking(
  purchase: {
    paymentReference: string;
    membershipId: string;
    firstSessionId: string | null;
    fullName: string | null;
    email: string;
    phone: string | null;
    healthDeclarationNotes: string | null;
  },
  userId: string
) {
  try {
    const booking = await bookingService.createMembershipFirstBooking({
      purchaseReference: purchase.paymentReference,
      userId,
      membershipId: purchase.membershipId,
      firstSessionId: purchase.firstSessionId ?? "",
      fullName: purchase.fullName || "Sculpt LAB Member",
      email: purchase.email,
      phone: purchase.phone || "",
      healthDeclarationNotes: purchase.healthDeclarationNotes,
    });

    if (booking.bookingStatus === "CONFIRMED") {
      return {
        status: "CONFIRMED" as const,
        bookingId: booking.id,
        sessionId: booking.sessionId,
      };
    }

    return {
      status: "NOT_CONFIRMED" as const,
      sessionId: purchase.firstSessionId,
      reason: "The first class could not be confirmed.",
      retryAvailable: true,
    };
  } catch (error) {
    const reason =
      error instanceof Error
        ? error.message
        : "The first class could not be confirmed.";

    console.error(
      "[OFFLINE PURCHASE] Activated, but the first class could not be booked:",
      purchase.paymentReference,
      reason
    );

    return {
      status: "NOT_CONFIRMED" as const,
      sessionId: purchase.firstSessionId,
      reason,
      // Retrying can't help once another class has started the
      // membership; the class must be booked normally instead.
      retryAvailable: !reason.includes("already started from another booking"),
    };
  }
}


async createManualMembershipForRegisteredUser(data: {
  userId: string;
  membershipId: string;
  totalCredits?: number;
  usedCredits?: number;
  startDate?: string;
}) {
  const user = await prisma.user.findUnique({
    where: { id: data.userId },
  });

  if (!user || user.role !== UserRole.MEMBER) {
    throw new Error("Registered member not found.");
  }

  const membership = await prisma.membership.findUnique({
    where: { id: data.membershipId },
  });

  if (!membership) {
    throw new Error("Membership not found.");
  }

  if (!membership.isActive) {
    throw new Error("This membership is not active.");
  }

  if (
    membership.type !== MembershipType.GROUP &&
    membership.type !== MembershipType.PRIVATE
  ) {
    throw new Error("Unsupported membership type.");
  }

  const usedCredits = data.usedCredits ?? 0;

  let totalCredits: number | null = membership.classLimit;

  if (membership.classLimit === null) {
    if (
      data.totalCredits !== undefined ||
      usedCredits !== 0
    ) {
      throw new Error(
        "Credits cannot be set for an unlimited membership."
      );
    }

    totalCredits = null;
  } else {
    totalCredits = data.totalCredits ?? membership.classLimit;

    if (
      !Number.isInteger(totalCredits) ||
      totalCredits < 1
    ) {
      throw new Error(
        "Total credits must be a positive integer."
      );
    }

    if (
      !Number.isInteger(usedCredits) ||
      usedCredits < 0 ||
      usedCredits > totalCredits
    ) {
      throw new Error(
        "Used credits must be between 0 and total credits."
      );
    }
  }

  /*
   * An admin-entered start date records a membership that has
   * already started (for example, moving an existing member over).
   * Without one, the membership waits for its first booked session
   * instead of starting today. BookingService.bookMemberSession
   * starts it on that session's date.
   */
  const startDate = data.startDate
    ? new Date(`${data.startDate}T00:00:00.000Z`)
    : null;

  if (startDate && Number.isNaN(startDate.getTime())) {
    throw new Error("Invalid membership start date.");
  }

  // Same duration rules as every other path. Private session plans
  // and packages have no expiry; an unknown duration throws.
  const expiryDate = startDate
    ? bookingService.calculateMembershipExpiry(
        startDate,
        membership.duration,
        membership.period
      )
    : null;

  let membershipNumber = generateMembershipNumber();

  while (
    (await prisma.memberMembership.findFirst({
      where: { membershipNumber },
    })) ||
    (await prisma.membershipActivation.findUnique({
      where: { membershipNumber },
    }))
  ) {
    membershipNumber = generateMembershipNumber();
  }

  return prisma.$transaction(async (tx) => {
    const now = new Date();

    // Find the member's existing active memberships.
    const existingMemberships =
      await tx.memberMembership.findMany({
        where: {
          userId: user.id,
          status: MembershipStatus.ACTIVE,
          OR: [
            { expiryDate: null },
            { expiryDate: { gt: now } },
          ],
        },
        include: {
          membership: true,
        },
      });

    // Only combine credits belonging to the same membership type.
    const sameTypeMemberships = existingMemberships.filter(
      (item) => {
        const sameType =
          item.membership.type === membership.type;

        const hasRemainingCredits =
          item.creditsTotal === null ||
          item.creditsUsed < item.creditsTotal;

        return sameType && hasRemainingCredits;
      }
    );

    // Extend finite, same-type memberships with remaining credits to the
    // newly assigned finite plan's expiry. Keep unlimited memberships
    // non-expiring, and never turn a finite membership into an unlimited one
    // merely because the newly assigned plan has no expiry.
    if (expiryDate !== null && totalCredits !== null) {
      for (const existing of sameTypeMemberships) {
        // An unlimited existing record must remain unlimited.
        if (existing.creditsTotal === null) {
          continue;
        }

        await tx.memberMembership.update({
          where: {
            id: existing.id,
          },
          data: {
            expiryDate,
          },
        });
      }
    }

    // Create a separate record for the newly added plan.
    // Its credits join the existing balance through aggregation.
    return tx.memberMembership.create({
      data: {
        userId: user.id,
        membershipId: membership.id,
        status: MembershipStatus.ACTIVE,
        startDate,
        expiryDate,
        creditsTotal: totalCredits,
        creditsUsed: usedCredits,
        membershipNumber,
      },
      include: {
        membership: true,
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
          },
        },
      },
    });
  });
}

async completeActivation(data: CompleteActivationDto) {
  const tokenHash = hashActivationToken(
    data.activationToken
  );

  const activation =
    await prisma.membershipActivation.findUnique({
      where: {
        membershipNumber: data.membershipNumber,
      },
      include: {
        booking: true,
        membershipPurchase: true,
        memberMembership: true,
      },
    });

  if (!activation) {
    throw new Error("Invalid membership number.");
  }

  if (activation.usedAt) {
    // Already activated. With the right token, confirm it is linked to
    // its owner and report success (idempotent). A used link never
    // logs anyone in again, and never re-links anything.
    if (tokenHash === activation.tokenHash) {
      const linked = await this.getActivatedOwner(activation);

      if (linked) {
        return {
          alreadyActivated: true as const,
          existingAccount: true,
          user: linked.user,
          membership: linked.membership,
        };
      }
    }

    throw new Error("This activation has already been used.");
  }

  if (activation.expiresAt < new Date()) {
    throw new Error("This activation link has expired.");
  }

  if (tokenHash !== activation.tokenHash) {
    throw new Error("Invalid activation token.");
  }

  const booking = activation.booking;
  const purchase = activation.membershipPurchase;

  // An activation must belong to exactly one source.
  if (Boolean(booking) === Boolean(purchase)) {
    throw new Error(
      "Invalid activation record. Please contact Sculpt LAB."
    );
  }

  // The membership must be the one created for this booking or
  // purchase; otherwise the records need an admin to look at them.
  if (
    (booking?.memberMembershipId &&
      booking.memberMembershipId !== activation.memberMembershipId) ||
    (purchase &&
      activation.memberMembership.membershipPurchaseId !== purchase.id)
  ) {
    throw new Error(
      "This activation's membership does not match its booking or purchase. Please contact Sculpt LAB."
    );
  }

  const source = booking ?? purchase!;
  const email = source.email?.trim().toLowerCase();

  if (!email) {
    throw new Error(
      "Email address is required. Please contact Sculpt LAB admin."
    );
  }

  // The activation must use the email from the original purchase or booking.
  if (
    data.email &&
    data.email.trim().toLowerCase() !== email
  ) {
    throw new Error(
      "The email must match the email associated with this membership."
    );
  }

  const hashedPassword = await bcrypt.hash(
    data.password,
    12
  );

  const result = await prisma.$transaction(async (tx) => {
    // The account registered with this email, if any (emails compared
    // case-insensitively, so a differently-cased address never gets a
    // second account). The activation link, sent to that email, is the
    // proof of ownership that lets the membership join that account.
    let user = await tx.user.findFirst({
      where: {
        email: {
          equals: email,
          mode: "insensitive",
        },
      },
    });

    const existingAccount = Boolean(user);
    const ownerId = user?.id ?? null;

    // Never move records that already belong to a different account.
    if (
      purchase?.userId &&
      purchase.userId !== ownerId
    ) {
      throw new Error(
        "This membership purchase is already linked to another account."
      );
    }

    if (booking?.userId && booking.userId !== ownerId) {
      throw new Error(
        "This booking is already linked to a different account. Please contact Sculpt LAB."
      );
    }

    if (
      activation.memberMembership.userId &&
      activation.memberMembership.userId !== ownerId
    ) {
      throw new Error(
        "This membership is already linked to a different account. Please contact Sculpt LAB."
      );
    }

    if (!user) {
      user = await tx.user.create({
        data: {
          fullName:
            data.fullName?.trim() ||
            source.fullName ||
            "Sculpt LAB Member",

          email,

          phone:
            data.phone?.trim() ||
            source.phone ||
            null,

          password: hashedPassword,
          provider: AuthProvider.LOCAL,
          role: "MEMBER",
          isEmailVerified: true,
        },
      });
    } else {
      user = await tx.user.update({
        where: {
          id: user.id,
        },
        data: {
          fullName:
            data.fullName?.trim() ||
            user.fullName,

          phone:
            data.phone?.trim() ||
            user.phone,

          ...(user.password
            ? {}
            : {
                password: hashedPassword,
              }),
        },
      });
    }

    // Attach the account to the original booking OR purchase, and to
    // its membership. Each update only applies while the record is
    // unlinked or already this user's, so a concurrent link to someone
    // else is never overwritten. Nothing else about the records changes:
    // dates, credits, status, membership number and history stay as
    // they are (an expired membership stays expired).
    const linkFilter = {
      OR: [{ userId: null }, { userId: user.id }],
    };

    const linked =
      booking
        ? await tx.booking.updateMany({
            where: { id: booking.id, ...linkFilter },
            data: { userId: user.id },
          })
        : await tx.membershipPurchase.updateMany({
            where: { id: purchase!.id, ...linkFilter },
            data: { userId: user.id },
          });

    const membershipLinked =
      await tx.memberMembership.updateMany({
        where: { id: activation.memberMembershipId, ...linkFilter },
        data: { userId: user.id },
      });

    if (linked.count !== 1 || membershipLinked.count !== 1) {
      throw new Error(
        "This membership is already linked to a different account. Please contact Sculpt LAB."
      );
    }

    const memberMembership =
      await tx.memberMembership.findUniqueOrThrow({
        where: { id: activation.memberMembershipId },
      });

    // Only one request should be allowed to consume this activation.
    const activationUpdate =
      await tx.membershipActivation.updateMany({
        where: {
          id: activation.id,
          usedAt: null,
        },
        data: {
          usedAt: new Date(),
        },
      });

    if (activationUpdate.count !== 1) {
      throw new Error(
        "This activation has already been used."
      );
    }

    return {
      user,
      memberMembership,
      existingAccount,
    };
  });

  const jwtPayload = {
    userId: result.user.id,
    email: result.user.email,
    role: result.user.role,
  };

  const accessToken =
    generateAccessToken(jwtPayload);

  const refreshToken =
    generateRefreshToken(jwtPayload);

  await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      userId: result.user.id,
      expiresAt: new Date(
        Date.now() + 30 * 24 * 60 * 60 * 1000
      ),
    },
  });

  return {
    user: {
      id: result.user.id,
      fullName: result.user.fullName,
      email: result.user.email,
      phone: result.user.phone,
      role: result.user.role,
    },

    membership: result.memberMembership,

    // The membership joined an account that was already registered
    // with this email (its password is unchanged).
    existingAccount: result.existingAccount,

    accessToken,
    refreshToken,
  };
}

/**
 * For a used activation: the account it was completed for, if its
 * booking or purchase and its membership are all linked to the account
 * registered with the activation's email. Used to answer a repeated
 * activation idempotently.
 */
private async getActivatedOwner(activation: {
  memberMembership: { userId: string | null } & Record<string, unknown>;
  booking: { userId: string | null; email: string | null } | null;
  membershipPurchase: { userId: string | null; email: string } | null;
}) {
  const ownerId = activation.memberMembership.userId;
  const source = activation.booking ?? activation.membershipPurchase;

  if (!ownerId || !source || source.userId !== ownerId) {
    return null;
  }

  const user = await prisma.user.findUnique({ where: { id: ownerId } });

  if (
    !user ||
    !source.email ||
    user.email.trim().toLowerCase() !== source.email.trim().toLowerCase()
  ) {
    return null;
  }

  return {
    user: {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      role: user.role,
    },
    membership: activation.memberMembership,
  };
}

  
async resendActivationForEmail(email: string) {
  const normalizedEmail = email.trim().toLowerCase();

  const activation =
    await prisma.membershipActivation.findFirst({
      where: {
        usedAt: null,
        OR: [
          {
            booking: {
              is: {
                email: {
                  equals: normalizedEmail,
                  mode: "insensitive",
                },
                paymentStatus: "PAID",
                paymentMethod: "OFFLINE",
              },
            },
          },
          {
            membershipPurchase: {
              is: {
                email: {
                  equals: normalizedEmail,
                  mode: "insensitive",
                },
                paymentStatus: "PAID",
                paymentMethod: "OFFLINE",
              },
            },
          },
        ],
      },
      include: {
        booking: {
          include: {
            membership: true,
          },
        },
        membershipPurchase: {
          include: {
            membership: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

  if (!activation) {
    return {
      found: false,
      emailSent: false,
    };
  }

  const booking = activation.booking;
  const purchase = activation.membershipPurchase;

  // An activation must belong to exactly one source.
  if (Boolean(booking) === Boolean(purchase)) {
    throw new Error(
      "Invalid activation record. Please contact Sculpt LAB."
    );
  }

  const source = booking ?? purchase!;

  const activationToken = generateActivationToken();
  const tokenHash = hashActivationToken(activationToken);

  const expiresAt = new Date();

  expiresAt.setDate(
    expiresAt.getDate() + ACTIVATION_EXPIRY_DAYS
  );

  await prisma.membershipActivation.update({
    where: {
      id: activation.id,
    },
    data: {
      tokenHash,
      expiresAt,
    },
  });

  try {
    await sendActivationEmail({
      email: normalizedEmail,
      fullName:
        source.fullName || "Sculpt LAB Member",
      membershipName: source.membership.name,
      membershipNumber: activation.membershipNumber,
      activationToken,
      amount: source.amount,
    });

    console.log(
      "Membership activation email resent:",
      normalizedEmail
    );

    return {
      found: true,
      emailSent: true,
    };
  } catch (error) {
    console.error(
      "Failed to resend membership activation email:",
      normalizedEmail,
      error
    );

    return {
      found: true,
      emailSent: false,
    };
  }
}
}

export const membershipActivationService =
  new MembershipActivationService();