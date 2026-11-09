import crypto from "crypto";
import bcrypt from "bcrypt";
import { AuthProvider, MembershipStatus,UserRole } from "@prisma/client";
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

function getMembershipExpiry(
  startDate: Date,
  duration: string
): Date | null {
  const expiry = new Date(startDate);

  const normalized = duration.trim().toLowerCase();

  if (
    normalized.includes("single") ||
    normalized.includes("class")
  ) {
    expiry.setDate(expiry.getDate() + 30);
    return expiry;
  }

  if (normalized.includes("week")) {
    const match = normalized.match(/\d+/);
    const weeks = match ? Number(match[0]) : 1;

    expiry.setDate(expiry.getDate() + weeks * 7);
    return expiry;
  }

  if (
    normalized.includes("month") ||
    normalized.includes("monthly")
  ) {
    const match = normalized.match(/\d+/);
    const months = match ? Number(match[0]) : 1;

    expiry.setMonth(expiry.getMonth() + months);
    return expiry;
  }

  if (
    normalized.includes("year") ||
    normalized.includes("annual")
  ) {
    const match = normalized.match(/\d+/);
    const years = match ? Number(match[0]) : 1;

    expiry.setFullYear(expiry.getFullYear() + years);
    return expiry;
  }

  return null;
}

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

    const startDate = new Date();

    const expiryDate = getMembershipExpiry(
      startDate,
      booking.membership.duration
    );

 
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

  if (purchase.membershipActivation) {
    throw new Error(
      "An activation has already been created for this purchase."
    );
  }

  let memberMembership = purchase.memberMembership;
  let userId = purchase.userId;

  // A purchase with a selected first session needs a user account
  // because the first booking must be attached to that account.
  if (purchase.firstSessionId) {
    if (!purchase.healthDeclarationAccepted) {
      throw new Error(
        "The health and safety declaration must be accepted before confirming this purchase."
      );
    }

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
    await prisma.membershipPurchase.update({
      where: { id: purchase.id },
      data: { userId },
    });
  }

  // Create the membership record if it doesn't exist.
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

  // If a first session was selected, create and confirm its booking.
  // This does NOT initialize another payment.
  if (purchase.firstSessionId) {
    if (!userId) {
      throw new Error("A user account is required for the first booking.");
    }

    await bookingService.createMembershipFirstBooking({
      purchaseReference: purchase.paymentReference,
      userId,
      membershipId: purchase.membershipId,
      firstSessionId: purchase.firstSessionId,
      fullName: purchase.fullName || "Sculpt LAB Member",
      email: purchase.email,
      phone: purchase.phone || "",
      healthDeclarationNotes: purchase.healthDeclarationNotes,
    });
  }

  // Generate activation credentials.
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
  expiresAt.setDate(expiresAt.getDate() + ACTIVATION_EXPIRY_DAYS);

  // bookingId is intentionally omitted:
  // this activation belongs to the membership purchase.
  const activation = await prisma.membershipActivation.create({
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

  const activationUrl = `${FRONTEND_URL}/activate?membership=${encodeURIComponent(
    membershipNumber
  )}&token=${encodeURIComponent(activationToken)}`;

  let emailSent = false;

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

  return {
    purchaseId: purchase.id,
    paymentReference: purchase.paymentReference,
    membershipNumber,
    email: purchase.email,
    phone: purchase.phone,
    fullName: purchase.fullName,
    activationUrl,
    emailSent,
  };
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
    let user = await tx.user.findUnique({
      where: {
        email,
      },
    });

    // Do not allow a purchase already attached to another account
    // to be linked to a different account.
    if (
      purchase?.userId &&
      purchase.userId !== user?.id
    ) {
      throw new Error(
        "This membership purchase is already linked to another account."
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

    // Attach the account to the original booking OR purchase.
    if (booking) {
      await tx.booking.update({
        where: {
          id: booking.id,
        },
        data: {
          userId: user.id,
        },
      });
    } else if (purchase) {
      await tx.membershipPurchase.update({
        where: {
          id: purchase.id,
        },
        data: {
          userId: user.id,
        },
      });
    }

    const memberMembership =
      await tx.memberMembership.update({
        where: {
          id: activation.memberMembershipId,
        },
        data: {
          userId: user.id,
          status: MembershipStatus.ACTIVE,
        },
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

    accessToken,
    refreshToken,
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