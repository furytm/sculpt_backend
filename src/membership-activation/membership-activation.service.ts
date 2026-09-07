import crypto from "crypto";
import bcrypt from "bcrypt";
import { AuthProvider, MembershipStatus } from "@prisma/client";
import prisma from "../config/prisma.js";

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

function generateMembershipNumber(): string {
  const year = new Date().getFullYear();

  const randomNumber = crypto.randomInt(100000, 999999);

  return `SL-${year}-${randomNumber}`;
}

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
            <body style="margin:0;padding:0;background:#f7f5f1;font-family:Arial,sans-serif;color:#222;">
              <div style="max-width:600px;margin:40px auto;background:#ffffff;padding:40px;border-radius:12px;">
                
                <h1 style="margin:0 0 24px;font-size:28px;">
                  Welcome to Sculpt LAB
                </h1>

                <p style="font-size:16px;line-height:1.6;">
                  Hi ${escapeHtml(fullName)},
                </p>

                <p style="font-size:16px;line-height:1.6;">
                  Your payment of <strong>₦${amount.toLocaleString()}</strong>
                  for your <strong>${escapeHtml(membershipName)}</strong>
                  has been confirmed.
                </p>

                <div style="margin:28px 0;padding:20px;background:#f7f5f1;border-radius:8px;">
                  <p style="margin:0 0 8px;font-size:13px;color:#777;">
                    MEMBERSHIP NUMBER
                  </p>

                  <p style="margin:0;font-size:24px;font-weight:bold;">
                    ${escapeHtml(membershipNumber)}
                  </p>
                </div>

                <p style="font-size:16px;line-height:1.6;">
                  Your membership is ready to be activated.
                  Click the button below to create your Sculpt LAB
                  account and link your membership.
                </p>

                <div style="margin:32px 0;">
                  <a
                    href="${activationUrl}"
                    style="display:inline-block;padding:14px 24px;background:#222;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;"
                  >
                    Activate My Membership
                  </a>
                </div>

                <p style="font-size:14px;line-height:1.6;color:#666;">
                  Your activation link is valid for ${ACTIVATION_EXPIRY_DAYS} days.
                </p>

                <p style="font-size:14px;line-height:1.6;color:#666;">
                  If you did not make this payment, please contact Sculpt LAB.
                </p>

                <p style="margin-top:32px;font-size:16px;">
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
  async createActivationForBooking(bookingId: string) {
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
      throw new Error("Activation is only required for offline payments.");
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
      memberMembership = await prisma.memberMembership.create({
        data: {
          userId: booking.userId ?? null,
          membershipId: booking.membershipId,
          bookingId: booking.id,
          status: MembershipStatus.ACTIVE,
          startDate,
          expiryDate,
        },
      });
    }

    const activationToken = generateActivationToken();
    const tokenHash = hashActivationToken(activationToken);

    let membershipNumber = generateMembershipNumber();

    while (
      await prisma.membershipActivation.findUnique({
        where: { membershipNumber },
      })
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

    try {
      await sendActivationEmail({
        email: booking.email,
        fullName: booking.fullName,
        membershipName: booking.membership.name,
        membershipNumber,
        activationToken,
        amount: booking.amount,
      });
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

    return {
      bookingId: booking.id,
      paymentReference: booking.paymentReference,
      membershipNumber,
      email: booking.email,
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

    return {
      valid: true,
      membershipNumber: activation.membershipNumber,
      email: activation.booking.email,
      fullName: activation.booking.fullName,
      phone: activation.booking.phone,
      membership: activation.booking.membership,
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

    const hashedPassword = await bcrypt.hash(
      data.password,
      12
    );

    const result = await prisma.$transaction(async (tx) => {
      let user = await tx.user.findUnique({
        where: {
          email: booking.email.toLowerCase(),
        },
      });

      if (!user) {
        user = await tx.user.create({
          data: {
            fullName: data.fullName || booking.fullName,
            email: booking.email.toLowerCase(),
            phone: data.phone || booking.phone,
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
            fullName: data.fullName || user.fullName,
            phone: data.phone || user.phone,
            ...(user.password
              ? {}
              : {
                  password: hashedPassword,
                }),
          },
        });
      }

      const updatedBooking = await tx.booking.update({
        where: {
          id: booking.id,
        },
        data: {
          userId: user.id,
        },
      });

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

      await tx.membershipActivation.update({
        where: {
          id: activation.id,
        },
        data: {
          usedAt: new Date(),
        },
      });

      return {
        user,
        booking: updatedBooking,
        memberMembership,
      };
    });

    const jwtPayload = {
      userId: result.user.id,
      email: result.user.email,
      role: result.user.role,
    };

    const accessToken = generateAccessToken(jwtPayload);
    const refreshToken = generateRefreshToken(jwtPayload);

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
}

export const membershipActivationService =
  new MembershipActivationService();