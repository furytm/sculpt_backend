import prisma from "../config/prisma.js";
import { MembershipType } from "@prisma/client";
import {
  MembershipStatus,
  MembershipPurchaseType,
  PaymentStatus,PaymentMethod,SessionStatus,
} from "@prisma/client";
import bookingService from "../booking/booking.service.js";
import { generateMembershipNumber } from "../utils/membership-number.js";


import paymentService from "../payment/payment.service.js";

import crypto from "crypto";




class MembershipService {

  
  /**
   * Get all active memberships
   */
  async getAllMemberships(type?: MembershipType) {
    return await prisma.membership.findMany({
      where: {
        isActive: true,
        ...(type && { type }),
      },
      orderBy: {
        displayOrder: "asc",
      },
    });
  }

  /**
   * Get a membership by ID
   */
 

  async getMembershipById(id: string) {
    return await prisma.membership.findUnique({
      where: {
        id,
      },
    });
  }
  /**
   * Create a new membership
   */
  async createMembership(data: {
    name: string;
    slug: string;
    description?: string;
    price: number;
    period: string;
      type: MembershipType;

    classLimit: number | null;
    duration: string;
    features: string[];
    highlighted?: boolean;
    badge?: string;
    displayOrder?: number;
    autoRenew?: boolean;
    isActive?: boolean;
  }) {
    return await prisma.membership.create({
      data: {
        name: data.name,
        slug: data.slug,
        description: data.description,
  type: data.type,
        price: data.price,
        period: data.period,

        classLimit: data.classLimit,
        duration: data.duration,

        features: data.features,

        highlighted: data.highlighted ?? false,
        badge: data.badge,

        displayOrder: data.displayOrder ?? 0,

        autoRenew: data.autoRenew ?? false,
        isActive: data.isActive ?? true,
      },
    });
  }

  /**
   * Update membership
   */
  async updateMembership(
    id: string,
    data: {
      name?: string;
      slug?: string;
      description?: string;
      price?: number;
      period?: string;
          type?: MembershipType;
      classLimit?: number | null;
      duration?: string;
      features?: string[];
      highlighted?: boolean;
      badge?: string;
      displayOrder?: number;
      autoRenew?: boolean;
      isActive?: boolean;
    }
  ) {
    const membership = await prisma.membership.findUnique({
      where: { id },
    });

    if (!membership) {
      throw new Error("Membership not found.");
    }

    return await prisma.membership.update({
      where: { id },
      data,
    });
  }
  

  /**
   * Soft delete membership
   */
  async deleteMembership(id: string) {
    const membership = await prisma.membership.findUnique({
      where: { id },
    });

    if (!membership) {
      throw new Error("Membership not found.");
    }

    return await prisma.membership.update({
      where: {
        id,
      },
      data: {
        isActive: false,
      },
    });
  }

async initiateUpgrade(
  userId: string,
  targetMembershipId: string
) {
  if (!userId) {
    throw new Error("Authentication is required.");
  }

  if (!targetMembershipId) {
    throw new Error("Target membership is required.");
  }

  const targetMembership = await prisma.membership.findUnique({
    where: { id: targetMembershipId },
  });

  if (!targetMembership) {
    throw new Error("Target membership not found.");
  }

  if (!targetMembership.isActive) {
    throw new Error("This membership is no longer available.");
  }

  const now = new Date();

  /*
   * First find a membership whose validity period
   * has not expired, regardless of its status field.
   */
  let currentMembership = await prisma.memberMembership.findFirst({
    where: {
      userId,
      OR: [
        { expiryDate: null },
        { expiryDate: { gt: now } },
      ],
    },
    include: {
      membership: true,
    },
    orderBy: {
      expiryDate: "asc",
    },
  });

  /*
   * If there is no valid membership, use the latest
   * membership record, even if it has expired.
   */
  if (!currentMembership) {
    currentMembership = await prisma.memberMembership.findFirst({
      where: { userId },
      include: {
        membership: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  if (!currentMembership) {
    throw new Error(
      "No previous membership found. Please purchase a new membership first."
    );
  }

  if (currentMembership.membershipId === targetMembership.id) {
    throw new Error("You are already on this membership.");
  }

  const membershipIsStillValid =
    currentMembership.expiryDate === null ||
    currentMembership.expiryDate > now;

  const carriedCredits = membershipIsStillValid
    ? Math.max(
        (currentMembership.creditsTotal ?? 0) -
          currentMembership.creditsUsed,
        0
      )
    : 0;

const previousCreditsUsed = membershipIsStillValid
  ? currentMembership.creditsUsed ?? 0
  : 0;

const newCreditsTotal =
  targetMembership.classLimit === null
    ? null
    : targetMembership.classLimit +
      carriedCredits +
      previousCreditsUsed;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });

  if (!user) {
    throw new Error("User not found.");
  }

  /*
   * Close any previous pending upgrade for this target.
   */
  const existingPendingPurchase =
    await prisma.membershipPurchase.findFirst({
      where: {
        userId,
        membershipId: targetMembership.id,
        type: MembershipPurchaseType.UPGRADE,
        paymentStatus: PaymentStatus.PENDING,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

  if (existingPendingPurchase) {
    await prisma.membershipPurchase.update({
      where: {
        id: existingPendingPurchase.id,
      },
      data: {
        paymentStatus: PaymentStatus.FAILED,
      },
    });
  }

  const paymentReference = `SL-UPGRADE-${Date.now()}`;

  const purchase = await prisma.membershipPurchase.create({
    data: {
      userId,
      email: user.email,
      membershipId: targetMembership.id,

      // This is the previous catalogue membership ID,
      // matching the existing meaning of this field.
  previousMemberMembershipId: currentMembership.id,

      type: MembershipPurchaseType.UPGRADE,
      amount: targetMembership.price,
      paymentReference,
      paymentStatus: PaymentStatus.PENDING,
      carriedCredits,
    },
  });

  try {
    const payment = await paymentService.initializeTransaction({
      email: user.email,
      amount: targetMembership.price,
      reference: paymentReference,
    });

    const authorizationUrl =
      payment?.data?.authorization_url ??
      payment?.data?.authorizationUrl ??
      payment?.authorization_url ??
      payment?.authorizationUrl;

    if (!authorizationUrl) {
      throw new Error(
        "Payment provider did not return a payment URL."
      );
    }

    return {
      purchaseId: purchase.id,
      reference: paymentReference,
      authorizationUrl,
      amount: targetMembership.price,
      carriedCredits,
      newCreditsTotal,
      membership: targetMembership,
      reusedPendingPurchase: false,
    };
  } catch (error) {
    // Keep the pending purchase for reconciliation.
    throw error;
  }
}

async initiateRenewal(
  userId: string,
  membershipId?: string
) {
  if (!userId) {
    throw new Error("Authentication is required.");
  }

  /*
   * Find the member's latest membership.
   */
  const currentMembership =
    await prisma.memberMembership.findFirst({
      where: {
        userId,
      },

      include: {
        membership: true,
      },

      orderBy: {
        createdAt: "desc",
      },
    });

  if (!currentMembership && !membershipId) {
    throw new Error(
      "No membership found to renew."
    );
  }

  /*
   * Renewal always uses the member's existing
   * membership unless a membershipId was explicitly supplied.
   */
  const targetMembershipId =
    membershipId ??
    currentMembership!.membershipId;

  const targetMembership =
    await prisma.membership.findUnique({
      where: {
        id: targetMembershipId,
      },
    });

  if (!targetMembership) {
    throw new Error(
      "Membership to renew was not found."
    );
  }

  if (!targetMembership.isActive) {
    throw new Error(
      "This membership is no longer available."
    );
  }

  /*
   * Find an existing pending renewal.
   *
   * Do NOT block the user.
   *
   * If one exists, reuse it.
   */
  const existingPendingPurchase =
    await prisma.membershipPurchase.findFirst({
      where: {
        userId,

        membershipId:
          targetMembership.id,

        type:
          MembershipPurchaseType.RENEWAL,

        paymentStatus:
          PaymentStatus.PENDING,
      },

      orderBy: {
        createdAt: "desc",
      },
    });

  const user =
    await prisma.user.findUnique({
      where: {
        id: userId,
      },

      select: {
        email: true,
      },
    });

  if (!user) {
    throw new Error("User not found.");
  }

  /*
   * ==================================================
   * EXISTING PENDING RENEWAL
   * ==================================================
   *
   * Reuse the existing purchase and reference.
   */
if (existingPendingPurchase) {
  await prisma.membershipPurchase.update({
    where: {
      id: existingPendingPurchase.id,
    },
    data: {
      paymentStatus: PaymentStatus.FAILED,
    },
  });
}

  /*
   * ==================================================
   * NEW RENEWAL
   * ==================================================
   */

  const paymentReference =
    `SL-RENEW-${Date.now()}`;

  const purchase =
    await prisma.membershipPurchase.create({
  data: {
  userId,
  email: user.email,
  membershipId: targetMembership.id,
  type: MembershipPurchaseType.RENEWAL,
  amount: targetMembership.price,
  paymentReference,
  paymentStatus: PaymentStatus.PENDING,
},
    });

  const payment =
    await paymentService.initializeTransaction({
      email: user.email,

      amount:
        targetMembership.price,

      reference:
        paymentReference,
    });

  return {
    purchaseId:
      purchase.id,

    reference:
      payment.data.reference ??
      paymentReference,

    authorizationUrl:
      payment.data.authorization_url,

    amount:
      targetMembership.price,

    membership:
      targetMembership,

    reusedPendingPurchase: false,
  };
}


private calculateMembershipExpiry(
  startDate: Date,
  duration: string,
  period: string
): Date {
  const expiryDate = new Date(startDate);

  // Support existing labels such as "Monthly", "Weekly",
  // and numeric durations such as "1" with period "month".
  const normalizedDuration = duration.trim().toLowerCase();
  const normalizedPeriod = period.trim().toLowerCase();

  let durationValue = Number(normalizedDuration);
  let effectivePeriod = normalizedPeriod;

  if (!Number.isFinite(durationValue) || durationValue <= 0) {
    const labelMatch = normalizedDuration.match(
      /^(\d+(?:\.\d+)?)\s*(day|days|week|weeks|month|months|quarter|quarters|year|years|daily|weekly|monthly|quarterly|yearly)$/
    );

    if (labelMatch) {
      durationValue = Number(labelMatch[1]);
      effectivePeriod = labelMatch[2];
    } else {
      const labels: Record<string, { duration: number; period: string }> = {
        daily: { duration: 1, period: "day" },
        weekly: { duration: 1, period: "week" },
        monthly: { duration: 1, period: "month" },
        quarterly: { duration: 3, period: "month" },
        yearly: { duration: 1, period: "year" },
        annually: { duration: 1, period: "year" },
      };

      const label = labels[normalizedDuration];

      if (!label) {
        throw new Error(
          `Invalid membership duration: ${duration}`
        );
      }

      durationValue = label.duration;
      effectivePeriod = label.period;
    }
  }

  switch (effectivePeriod) {
    case "day":
    case "days":
      expiryDate.setDate(
        expiryDate.getDate() + durationValue
      );
      break;

    case "week":
    case "weeks":
      expiryDate.setDate(
        expiryDate.getDate() + durationValue * 7
      );
      break;

    case "month":
    case "months":
      expiryDate.setMonth(
        expiryDate.getMonth() + durationValue
      );
      break;

    case "quarter":
    case "quarters":
      expiryDate.setMonth(
        expiryDate.getMonth() + durationValue * 3
      );
      break;

    case "year":
    case "years":
      expiryDate.setFullYear(
        expiryDate.getFullYear() + durationValue
      );
      break;

    default:
      throw new Error(
        `Unsupported membership period: ${period}`
      );
  }

  return expiryDate;
}


private getMembershipCredits(
  classLimit: number | null
): number | null {
  return classLimit;
}
async completeMembershipPurchase(
  paymentReference: string
) {
  if (!paymentReference) {
    throw new Error(
      "Payment reference is required."
    );
  }
  const purchase =
  await prisma.membershipPurchase.findUnique({
    where: {
      paymentReference,
    },
    select: {
      paymentMethod: true,
      paymentStatus: true,
    },
  });

if (!purchase) {
  throw new Error("Membership purchase not found.");
}

if (purchase.paymentMethod !== PaymentMethod.PAYMISH) {
  throw new Error(
    "This purchase cannot be completed through the Paymish payment flow."
  );
}

const result = await prisma.$transaction(
  async (tx) => {
const purchase =
  await tx.membershipPurchase.findUnique({
    where: {
      paymentReference,
    },

    include: {
      membership: true,
      firstSession: {
        include: {
          schedule: true,
        },
      },
    },
  });
      if (!purchase) {
        throw new Error(
          "Membership purchase not found."
        );
      }

// Return the membership linked to this exact purchase.
// A PAID purchase without a linked membership must be
// allowed to continue through activation.
let linkedMembership = await tx.memberMembership.findUnique({
  where: {
    membershipPurchaseId: purchase.id,
  },
  include: {
    membership: true,
  },
});


if (linkedMembership) {
  // Assign a membership number if this membership does not have one.
  if (!linkedMembership.membershipNumber) {
    const previousMembership = purchase.userId
      ? await tx.memberMembership.findFirst({
          where: {
            userId: purchase.userId,
            membershipNumber: {
              not: null,
            },
            id: {
              not: linkedMembership.id,
            },
          },
          orderBy: {
            createdAt: "desc",
          },
          select: {
            membershipNumber: true,
          },
        })
      : null;

    let membershipNumber =
      previousMembership?.membershipNumber ?? null;

    if (!membershipNumber) {
      membershipNumber = generateMembershipNumber();

      while (
        (await tx.membershipActivation.findUnique({
          where: { membershipNumber },
        })) ||
        (await tx.memberMembership.findFirst({
          where: { membershipNumber },
        }))
      ) {
        membershipNumber = generateMembershipNumber();
      }
    }

    linkedMembership = await tx.memberMembership.update({
      where: {
        id: linkedMembership.id,
      },
      data: {
        membershipNumber,
      },
      include: {
        membership: true,
      },
    });
  }

  // Attach a guest membership to the purchaser's account.
  if (purchase.userId && !linkedMembership.userId) {
    linkedMembership = await tx.memberMembership.update({
      where: {
        id: linkedMembership.id,
      },
      data: {
        userId: purchase.userId,
      },
      include: {
        membership: true,
      },
    });
  }

 
// Never silently attach a membership belonging to another user.
if (
  purchase.userId &&
  linkedMembership.userId &&
  linkedMembership.userId !== purchase.userId
) {
  throw new Error(
    "Membership purchase is linked to a different user."
  );
}

// The Paymish callback has already verified this payment.
// Ensure the purchase is marked as PAID before returning
// the membership already linked to this exact purchase.
const updatedPurchase =
  purchase.paymentStatus !== PaymentStatus.PAID
    ? await tx.membershipPurchase.update({
        where: {
          id: purchase.id,
        },
        data: {
          paymentStatus: PaymentStatus.PAID,
        },
      })
    : purchase;

return {
  purchase: updatedPurchase,
  membership: linkedMembership,
};

}

      /*
       * Mark payment as paid.
       */
      await tx.membershipPurchase.update({
        where: {
          id: purchase.id,
        },

        data: {
          paymentStatus:
            PaymentStatus.PAID,
        },
      });

      /*
       * Find current active membership.
       */
 /*
 * Find the current membership.
 *
 * For upgrades, find the previous membership using the
 * catalogue ID saved on the purchase. This also works
 * when that membership has already expired.
 */
const currentMembership =
  purchase.type === MembershipPurchaseType.UPGRADE
    ? await tx.memberMembership.findFirst({
        where: {
          id: purchase.previousMemberMembershipId ?? "",
          userId: purchase.userId,
        },
        include: {
          membership: true,
        },
      })
    : await tx.memberMembership.findFirst({
        where: {
          userId: purchase.userId,
          status: MembershipStatus.ACTIVE,
        },
        include: {
          membership: true,
        },
        orderBy: {
          expiryDate: "asc",
        },
      });
        const previousMembership = purchase.userId
  ? await tx.memberMembership.findFirst({
      where: {
        userId: purchase.userId,
        membershipNumber: {
          not: null,
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        membershipNumber: true,
      },
    })
  : null;

const existingMembershipNumber =
  currentMembership?.membershipNumber ??
  previousMembership?.membershipNumber ??
  null;

// Reuse the member's existing number, or generate a new
// one and check that it does not already exist.
let membershipNumber = existingMembershipNumber;

if (!membershipNumber) {
  membershipNumber = generateMembershipNumber();

  while (
    (await tx.membershipActivation.findUnique({
      where: { membershipNumber },
    })) ||
    (await tx.memberMembership.findFirst({
      where: { membershipNumber },
    }))
  ) {
    membershipNumber = generateMembershipNumber();
  }
}


      const now = new Date();

   /*
 * ==================================================
 * UPGRADE
 * ==================================================
 */
if (
  purchase.type === MembershipPurchaseType.UPGRADE
) {
  if (!currentMembership) {
    throw new Error(
      "Previous membership not found for upgrade."
    );
  }

  const membershipIsStillValid =
    currentMembership.expiryDate === null ||
    currentMembership.expiryDate > now;

  /*
   * Only carry credits if the previous membership
   * is still within its validity period.
   */
const previousCreditsUsed = currentMembership.creditsUsed ?? 0;

const remainingCredits = membershipIsStillValid
  ? Math.max(
      (currentMembership.creditsTotal ?? 0) -
        previousCreditsUsed,
      0
    )
  : 0;

// Preserve historical usage while carrying forward unused credits.
const newCreditsTotal =
  purchase.membership.classLimit === null
    ? null
    : purchase.membership.classLimit +
      remainingCredits +
      (membershipIsStillValid ? previousCreditsUsed : 0);

const newCreditsUsed = membershipIsStillValid
  ? previousCreditsUsed
  : 0;

  /*
   * The new membership becomes usable immediately.
   *
   * However, when the previous membership is still
   * valid, calculate the new expiry from its existing
   * expiry date to preserve the remaining time.
   *
   * If expired, calculate from today.
   */
  const expiryBaseDate =
    membershipIsStillValid && currentMembership.expiryDate
      ? currentMembership.expiryDate
      : now;

  const startDate = now;

  const expiryDate = this.calculateMembershipExpiry(
    expiryBaseDate,
    purchase.membership.duration,
    purchase.membership.period
  );

  /*
   * Expire the previous membership after transferring
   * any eligible unused credits.
   */
  await tx.memberMembership.update({
    where: {
      id: currentMembership.id,
    },
    data: {
      status: MembershipStatus.EXPIRED,
    },
  });

  /*
   * Create the upgraded membership.
   */
  const newMembership = await tx.memberMembership.create({
    data: {
      userId: purchase.userId,
      membershipPurchaseId: purchase.id,
      membershipId: purchase.membershipId,
      membershipNumber,
      status: MembershipStatus.ACTIVE,
      startDate,
      expiryDate,
      creditsTotal: newCreditsTotal,
creditsUsed: newCreditsUsed,
    },
  });

  /*
   * Save the final carried credits on the purchase.
   */
  const updatedPurchase =
    await tx.membershipPurchase.update({
      where: {
        id: purchase.id,
      },
      data: {
        carriedCredits: remainingCredits,
        paymentStatus: PaymentStatus.PAID,
      },
    });

 return {
  purchase: updatedPurchase,
  membership: newMembership,
  carriedCredits: remainingCredits,
  creditsTotal: newCreditsTotal,
  remainingCredits:
    newCreditsTotal === null
      ? null
      : Math.max(newCreditsTotal - newCreditsUsed, 0),
};
}
      /*
 * ==================================================
 * NEW MEMBERSHIP PURCHASE
 * ==================================================
 */

if (purchase.type === MembershipPurchaseType.NEW) {
  const firstSession = purchase.firstSession;

  let startDate: Date | null = null;
  let expiryDate: Date | null = null;

  // A selected first session determines membership validity.
  if (firstSession) {
    if (
      firstSession.status !== "OPEN" ||
      !firstSession.schedule.isActive
    ) {
      throw new Error(
        "The selected first class session is no longer available."
      );
    }

    startDate = firstSession.sessionDate;

    expiryDate = this.calculateMembershipExpiry(
      startDate,
      purchase.membership.duration,
      purchase.membership.period
    );
  }

  const creditsTotal = this.getMembershipCredits(
    purchase.membership.classLimit
  );

  const newMembership = await tx.memberMembership.create({
    data: {
      userId: purchase.userId,
      membershipPurchaseId: purchase.id,
      membershipId: purchase.membershipId,
          membershipNumber,

      status: MembershipStatus.ACTIVE,

      startDate,
      expiryDate,

      creditsTotal,
      creditsUsed: 0,
    },
  });

  await tx.membershipPurchase.update({
    where: {
      id: purchase.id,
    },
    data: {
      paymentStatus: PaymentStatus.PAID,
    },
  });

  return {
    purchase,
    membership: newMembership,
    creditsTotal,
    remainingCredits: creditsTotal,
    firstSessionId: firstSession?.id ?? null,
    firstSessionDate: firstSession?.sessionDate ?? null,
    requiresFirstBooking: Boolean(firstSession),
  };
}
      /*
       * ==================================================
       * RENEWAL
       * ==================================================
       */

      let startDate = now;

      /*
       * If an active membership still exists,
       * renewal starts when the existing membership ends.
       */
      if (
        currentMembership?.expiryDate &&
        currentMembership.expiryDate > now
      ) {
        startDate =
          currentMembership.expiryDate;
      }

      const expiryDate =
        this.calculateMembershipExpiry(
          startDate,
          purchase.membership.duration,
          purchase.membership.period
        );

      const creditsTotal =
        this.getMembershipCredits(
          purchase.membership.classLimit
        );

      /*
       * If the current membership is expired,
       * mark it expired.
       *
       * If it is still active, leave it active
       * until its original expiry date.
       */
      if (
        currentMembership &&
        currentMembership.expiryDate &&
        currentMembership.expiryDate <= now
      ) {
        await tx.memberMembership.update({
          where: {
            id: currentMembership.id,
          },

          data: {
            status:
              MembershipStatus.EXPIRED,
          },
        });
      }

      /*
       * Create the renewed membership.
       *
       * Renewal gets its own fresh credit allowance.
       */
      const renewedMembership =
        await tx.memberMembership.create({
          data: {
            userId:
              purchase.userId,
              membershipPurchaseId: purchase.id,

            membershipId:
              purchase.membershipId,
                  membershipNumber,

            status:
              MembershipStatus.ACTIVE,

            startDate,

            expiryDate,

            creditsTotal,

            creditsUsed: 0,
          },
        });

      return {
        purchase,

        membership:
          renewedMembership,

        carriedCredits: 0,

        creditsTotal,

        remainingCredits:
          creditsTotal,
      };
       },
    {
      maxWait: 10000,
      timeout: 15000,
    }
  );

  // Automatically create the first booking only when the
  // customer selected a class session during membership checkout.
  // Membership-only purchases must not create a booking here.
if (
  result.purchase.type === MembershipPurchaseType.NEW &&
  result.purchase.firstSessionId &&
  result.purchase.userId
) {
  const fullName = result.purchase.fullName?.trim();
  const phone = result.purchase.phone?.trim();

  if (!fullName || !phone) {
    throw new Error(
      "Membership purchase is missing the customer's name or phone number. Cannot create the first booking."
    );
  }

  const existingFirstBooking = await prisma.booking.findUnique({
    where: {
      paymentReference: `${result.purchase.paymentReference}-FIRST-BOOKING`,
    },
  });

  if (
    !existingFirstBooking ||
    existingFirstBooking.bookingStatus !== "CONFIRMED"
  ) {
    await bookingService.createMembershipFirstBooking({
      purchaseReference: result.purchase.paymentReference,
      userId: result.purchase.userId,
      membershipId: result.purchase.membershipId,
      firstSessionId: result.purchase.firstSessionId,
      fullName,
      email: result.purchase.email,
      phone,
      healthDeclarationNotes:
        result.purchase.healthDeclarationNotes,
    });
  }
}

  return result;
}


async getMembershipPurchase(
  userId: string,
  paymentReference: string
) {
  const purchase =
    await prisma.membershipPurchase.findFirst({
      where: {
        userId,
        paymentReference,
      },
      include: {
        membership: true,
      },
    });

  if (!purchase) {
    return null;
  }

  const memberMembership =
    await prisma.memberMembership.findUnique({
      where: {
        membershipPurchaseId: purchase.id,
      },
    });

  // Ensure the linked membership belongs to this user.
  const ownedMembership =
    memberMembership?.userId === userId
      ? memberMembership
      : null;

  return {
    purchase: {
      id: purchase.id,
      paymentReference: purchase.paymentReference,
      type: purchase.type,
      amount: purchase.amount,
      paymentStatus: purchase.paymentStatus,
      carriedCredits: purchase.carriedCredits,
      createdAt: purchase.createdAt,
    },

    membership: purchase.membership,

    memberMembership: ownedMembership
      ? {
          id: ownedMembership.id,
          status: ownedMembership.status,
          startDate: ownedMembership.startDate,
          expiryDate: ownedMembership.expiryDate,
          creditsTotal: ownedMembership.creditsTotal,
          creditsUsed: ownedMembership.creditsUsed,
          remainingCredits:
            ownedMembership.creditsTotal === null
              ? null
              : Math.max(
                  ownedMembership.creditsTotal -
                    ownedMembership.creditsUsed,
                  0
                ),
        }
      : null,
  };
}


async getPublicMembershipConfirmation(
  paymentReference: string
) {
  const purchase =
    await prisma.membershipPurchase.findUnique({
      where: {
        paymentReference,
      },
      include: {
        membership: true,
      },
    });

  if (!purchase) {
    return null;
  }

 const memberMembership =
  await prisma.memberMembership.findUnique({
    where: {
      membershipPurchaseId: purchase.id,
    },
  });

  return {
purchase: {
  paymentReference: purchase.paymentReference,
  fullName: purchase.fullName,
  email: purchase.email,
  phone: purchase.phone,
  type: purchase.type,
  amount: purchase.amount,
  paymentStatus: purchase.paymentStatus,
  carriedCredits: purchase.carriedCredits,
  createdAt: purchase.createdAt,
},
    membership: {
      name: purchase.membership.name,
      price: purchase.membership.price,
      classLimit: purchase.membership.classLimit,
      duration: purchase.membership.duration,
      period: purchase.membership.period,
    },
    memberMembership: memberMembership
      ? {
          status: memberMembership.status,
          startDate: memberMembership.startDate,
          expiryDate: memberMembership.expiryDate,
          creditsTotal: memberMembership.creditsTotal,
          creditsUsed: memberMembership.creditsUsed,
          remainingCredits:
            memberMembership.creditsTotal === null
              ? null
              : Math.max(
                  memberMembership.creditsTotal -
                    memberMembership.creditsUsed,
                  0
                ),
        }
      : null,
  };
}

async initiateNewMembershipPurchase(data: {
  membershipId: string;
  fullName: string;
  email: string;
  phone: string;
  userId: string | null;
  firstSessionId?: string | null;
  firstClassId?: string | null;
  healthDeclarationAccepted?: boolean;
  healthDeclarationNotes?: string | null;
}) {
  const email = data.email.trim().toLowerCase();

  if (!data.membershipId || !email) {
    throw new Error("Membership and email are required.");
  }

  const membership = await prisma.membership.findFirst({
    where: {
      id: data.membershipId,
      isActive: true,
    },
  });

  if (!membership) {
    throw new Error("Membership not found or is not active.");
  }
  let selectedSession = null;

if (data.firstSessionId) {
  selectedSession = await prisma.classSession.findUnique({
    where: {
      id: data.firstSessionId,
    },
    include: {
      schedule: true,
    },
  });

  if (!selectedSession) {
    throw new Error("Selected class session was not found.");
  }

  if (
    selectedSession.status !== "OPEN" ||
    !selectedSession.schedule.isActive
  ) {
    throw new Error("Selected class session is unavailable.");
  }

  if (
    data.firstClassId &&
    selectedSession.schedule.className.toLowerCase() !==
      data.firstClassId.toLowerCase()
  ) {
    throw new Error(
      "Selected session does not belong to the selected class."
    );
  }

  if (data.healthDeclarationAccepted !== true) {
    throw new Error(
      "Health Declaration must be accepted before selecting a first session."
    );
  }
}

  const paymentReference =
    `SL-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    console.log("[MEMBERSHIP] Creating purchase", {
  membershipId: membership.id,
  email,
  userId: data.userId,
  paymentReference,
});
const purchase = await prisma.membershipPurchase.create({
data: {
  userId: data.userId,
  fullName: data.fullName.trim(),
  email,
  phone: data.phone.trim(),

  membershipId: membership.id,
  type: MembershipPurchaseType.NEW,
  amount: membership.price,

  paymentReference,
  paymentStatus: PaymentStatus.PENDING,

  firstSessionId: selectedSession?.id ?? null,
  firstClassId: data.firstClassId ?? null,

  healthDeclarationAccepted:
    data.healthDeclarationAccepted ?? false,

  healthDeclarationNotes:
    data.healthDeclarationNotes?.trim() || null,
},
});
console.log("[MEMBERSHIP] Purchase created", {
  purchaseId: purchase.id,
  paymentReference: purchase.paymentReference,
  paymentStatus: purchase.paymentStatus,
});
  try {
    const payment = await paymentService.initializeTransaction({
      email,
      amount: purchase.amount,
      reference: paymentReference,
    });

    const authorizationUrl =
      payment?.data?.authorization_url ??
      payment?.data?.authorizationUrl ??
      payment?.authorization_url ??
      payment?.authorizationUrl;

    if (!authorizationUrl) {
      throw new Error("Payment provider did not return a payment URL.");
    }

    return {
      success: true,
      purchaseId: purchase.id,
      reference: paymentReference,
      authorizationUrl,
    };
  } catch (error) {
    // Keep the pending purchase for reconciliation or a safe retry.
    throw error;
  }
}

async initiateOfflineMembershipPurchase(data: {
  membershipId: string;
  fullName: string;
  email: string;
  phone: string;
  userId: string | null;
  firstSessionId?: string | null;
  firstClassId?: string | null;
  healthDeclarationAccepted?: boolean;
  healthDeclarationNotes?: string | null;
}) {
  const email = data.email.trim().toLowerCase();

  // 1. Validate required customer and membership details
  if (
    !data.membershipId ||
    !data.fullName?.trim() ||
    !email ||
    !data.phone?.trim()
  ) {
    throw new Error(
      "Membership, name, email, and phone are required."
    );
  }

  // 2. Validate membership
  const membership = await prisma.membership.findFirst({
    where: {
      id: data.membershipId,
      isActive: true,
    },
  });

  if (!membership) {
    throw new Error(
      "Membership not found or is not active."
    );
  }

  // 3. Validate Health & Safety declaration when a first session is selected
  if (
    data.firstSessionId &&
    data.healthDeclarationAccepted !== true
  ) {
    throw new Error(
      "You must accept the Health & Safety declaration to book your first class."
    );
  }

  // 4. Validate selected first session
  let firstSession = null;

  if (data.firstSessionId) {
    firstSession = await prisma.classSession.findUnique({
      where: {
        id: data.firstSessionId,
      },
      include: {
        schedule: true,
      },
    });

    if (!firstSession) {
      throw new Error("Selected session not found.");
    }

    // Ensure session is open
    if (firstSession.status !== SessionStatus.OPEN) {
      throw new Error(
        "This session is no longer available."
      );
    }

    // Ensure the associated schedule is active
    if (!firstSession.schedule.isActive) {
      throw new Error(
        "The selected class is no longer available."
      );
    }

    // IMPORTANT:
    // Add your existing capacity validation and two-hour
    // booking-window validation here before creating the purchase.
  }

  // 5. Generate payment reference
  const paymentReference =
    `SL-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

  // 6. Create membership purchase
  const purchase = await prisma.membershipPurchase.create({
    data: {
      userId: data.userId,
      fullName: data.fullName.trim(),
      email,
      phone: data.phone.trim(),

      membershipId: membership.id,
      type: MembershipPurchaseType.NEW,
      amount: membership.price,

      // First class information
      firstSessionId: firstSession?.id ?? null,
      firstClassId: data.firstClassId ?? null,

      // Health & Safety declaration
      healthDeclarationAccepted:
        data.healthDeclarationAccepted ?? false,

      healthDeclarationNotes:
        data.healthDeclarationNotes?.trim() || null,

      // Payment information
      paymentReference,
      paymentStatus: PaymentStatus.PENDING,
      paymentMethod: PaymentMethod.OFFLINE,
    },
    include: {
      membership: true,
      firstSession: {
        include: {
          schedule: true,
        },
      },
    },
  });

  // 7. Return purchase details
  return {
    success: true,
    purchaseId: purchase.id,
    paymentReference: purchase.paymentReference,
    amount: purchase.amount,

    membership: purchase.membership,

    firstSession: purchase.firstSession,
    firstClassId: purchase.firstClassId,

    healthDeclarationAccepted:
      purchase.healthDeclarationAccepted,

    healthDeclarationNotes:
      purchase.healthDeclarationNotes,

    bankDetails: {
      accountName: "Sculpt LAB Limited",
      bankName: "Moniepoint",
      accountNumber: "3001445877",
    },
  };
}
}

export default new MembershipService();