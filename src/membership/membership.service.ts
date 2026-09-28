import prisma from "../config/prisma.js";
import { MembershipType } from "@prisma/client";
import {
  MembershipStatus,
  MembershipPurchaseType,
  PaymentStatus,
} from "@prisma/client";


import paymentService from "../payment/payment.service.js";

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
    throw new Error(
      "Target membership is required."
    );
  }

  const targetMembership =
    await prisma.membership.findUnique({
      where: {
        id: targetMembershipId,
      },
    });

  if (!targetMembership) {
    throw new Error(
      "Target membership not found."
    );
  }

  if (!targetMembership.isActive) {
    throw new Error(
      "This membership is no longer available."
    );
  }

  /*
   * Find the member's active membership.
   */
  const currentMembership =
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
        expiryDate: "asc",
      },
    });

  if (!currentMembership) {
    throw new Error(
      "You do not have an active membership to upgrade."
    );
  }

  if (
    currentMembership.membershipId ===
    targetMembership.id
  ) {
    throw new Error(
      "You are already on this membership."
    );
  }

  /*
   * Calculate unused credits.
   */
  const carriedCredits =
    currentMembership.creditsTotal === null
      ? 0
      : Math.max(
          currentMembership.creditsTotal -
            currentMembership.creditsUsed,
          0
        );

  const newCreditsTotal =
    targetMembership.classLimit === null
      ? null
      : targetMembership.classLimit +
        carriedCredits;

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
   * CHECK FOR EXISTING PENDING UPGRADE
   * ==================================================
   */
  const existingPendingPurchase =
    await prisma.membershipPurchase.findFirst({
      where: {
        userId,

        membershipId:
          targetMembership.id,

        type:
          MembershipPurchaseType.UPGRADE,

        paymentStatus:
          PaymentStatus.PENDING,
      },

      orderBy: {
        createdAt: "desc",
      },
    });

  /*
   * ==================================================
   * REUSE EXISTING PENDING UPGRADE
   * ==================================================
   */
  if (existingPendingPurchase) {
    const payment =
      await paymentService.initializeTransaction({
        email: user.email,

        amount:
          existingPendingPurchase.amount,

        reference:
          existingPendingPurchase.paymentReference,
      });

    return {
      purchaseId:
        existingPendingPurchase.id,

      reference:
        payment.data.reference ??
        existingPendingPurchase.paymentReference,

      authorizationUrl:
        payment.data.authorization_url,

      amount:
        existingPendingPurchase.amount,

      carriedCredits:
        existingPendingPurchase.carriedCredits,

      newCreditsTotal,

      membership:
        targetMembership,

      reusedPendingPurchase: true,
    };
  }

  /*
   * ==================================================
   * CREATE NEW UPGRADE PURCHASE
   * ==================================================
   */

  const paymentReference =
    `SL-UPGRADE-${Date.now()}`;

  const purchase =
    await prisma.membershipPurchase.create({
      data: {
        userId,

        membershipId:
          targetMembership.id,

        previousMembershipId:
          currentMembership.membershipId,

        type:
          MembershipPurchaseType.UPGRADE,

        amount:
          targetMembership.price,

        paymentReference,

        paymentStatus:
          PaymentStatus.PENDING,

        carriedCredits,
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

    carriedCredits,

    newCreditsTotal,

    membership:
      targetMembership,

    reusedPendingPurchase: false,
  };
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
    const payment =
      await paymentService.initializeTransaction({
        email: user.email,

        amount:
          existingPendingPurchase.amount,

        reference:
          existingPendingPurchase.paymentReference,
      });

    return {
      purchaseId:
        existingPendingPurchase.id,

      reference:
        payment.data.reference ??
        existingPendingPurchase.paymentReference,

      authorizationUrl:
        payment.data.authorization_url,

      amount:
        existingPendingPurchase.amount,

      membership:
        targetMembership,

      reusedPendingPurchase: true,
    };
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

        membershipId:
          targetMembership.id,

        previousMembershipId:
          currentMembership?.membershipId ??
          null,

        type:
          MembershipPurchaseType.RENEWAL,

        amount:
          targetMembership.price,

        paymentReference,

        paymentStatus:
          PaymentStatus.PENDING,

        carriedCredits: 0,
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

  const durationValue = Number(duration);

  if (Number.isNaN(durationValue)) {
    throw new Error(
      `Invalid membership duration: ${duration}`
    );
  }

  switch (period.toLowerCase()) {
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

  return await prisma.$transaction(
    async (tx) => {
      const purchase =
        await tx.membershipPurchase.findUnique({
          where: {
            paymentReference,
          },

          include: {
            membership: true,
          },
        });

      if (!purchase) {
        throw new Error(
          "Membership purchase not found."
        );
      }

      /*
       * Idempotency.
       *
       * If Paymish callback/webhook reaches us twice,
       * don't create two memberships.
       */
      if (
        purchase.paymentStatus ===
        PaymentStatus.PAID
      ) {
        return purchase;
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
      const currentMembership =
        await tx.memberMembership.findFirst({
          where: {
            userId:
              purchase.userId,

            status:
              MembershipStatus.ACTIVE,
          },

          include: {
            membership: true,
          },

          orderBy: {
            expiryDate: "asc",
          },
        });

      const now = new Date();

      /*
       * ==================================================
       * UPGRADE
       * ==================================================
       */
      if (
        purchase.type ===
        MembershipPurchaseType.UPGRADE
      ) {
        if (!currentMembership) {
          throw new Error(
            "Active membership not found for upgrade."
          );
        }

        const remainingCredits =
          currentMembership.creditsTotal === null
            ? 0
            : Math.max(
                currentMembership.creditsTotal -
                  currentMembership.creditsUsed,
                0
              );

        const newCreditsTotal =
          purchase.membership.classLimit === null
            ? null
            : purchase.membership.classLimit +
              remainingCredits;

        const startDate = now;

        const expiryDate =
          this.calculateMembershipExpiry(
            startDate,
            purchase.membership.duration,
            purchase.membership.period
          );

        /*
         * Expire the old membership.
         */
        await tx.memberMembership.update({
          where: {
            id: currentMembership.id,
          },

          data: {
            status:
              MembershipStatus.EXPIRED,
          },
        });

        /*
         * Create the upgraded membership.
         *
         * Example:
         * Old remaining = 5
         * New plan = 20
         * New total = 25
         */
        const newMembership =
          await tx.memberMembership.create({
            data: {
              userId:
                purchase.userId,

              membershipId:
                purchase.membershipId,

              status:
                MembershipStatus.ACTIVE,

              startDate,

              expiryDate,

              creditsTotal:
                newCreditsTotal,

              creditsUsed: 0,
            },
          });

        await tx.membershipPurchase.update({
          where: {
            id: purchase.id,
          },

          data: {
            carriedCredits:
              remainingCredits,
          },
        });

        return {
          purchase,
          membership:
            newMembership,

          carriedCredits:
            remainingCredits,

          creditsTotal:
            newCreditsTotal,

          remainingCredits:
            newCreditsTotal,
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

            membershipId:
              purchase.membershipId,

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
}
}

export default new MembershipService();