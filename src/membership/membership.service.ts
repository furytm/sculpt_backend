import prisma from "../config/prisma.js";
import { MembershipType, Prisma } from "@prisma/client";
import {
  MembershipStatus,
  MembershipPurchaseType,
  PaymentStatus,PaymentMethod,SessionStatus,
} from "@prisma/client";
import bookingService from "../booking/booking.service.js";
import { generateMembershipNumber } from "../utils/membership-number.js";


import paymentService from "../payment/payment.service.js";
import { adminNotificationService } from "../admin/admin-notification.service.js";

import crypto from "crypto";

/**
 * Reconciliation states for a FAILED purchase that received a
 * verified payment anyway (the customer paid an old link after the
 * purchase was cancelled or superseded).
 *
 * The schema has no status for this, so the state is stored as a
 * prefix in MembershipPurchase.paymentRejectionReason. That column
 * is otherwise only used for rejected offline transfers, and those
 * never reach the Paymish flow. The purchase stays FAILED until an
 * admin applies it (it becomes PAID) or records a refund.
 */
export const PURCHASE_RECONCILIATION = {
  NEEDS_REVIEW: "PAID_NEEDS_RECONCILIATION",
  APPLIED: "RECONCILED_APPLIED",
  REFUNDED: "RECONCILED_REFUNDED",
} as const;

/**
 * Thrown by completeMembershipPurchase for a FAILED (cancelled or
 * superseded) purchase. Payment callers catch it, because the money
 * was taken: they record it with recordPaymentForFailedPurchase so an
 * admin can refund or apply it, and they don't treat it as a failure
 * to retry.
 */
export class PaidFailedPurchaseError extends Error {
  readonly paymentReference: string;

  constructor(paymentReference: string) {
    super(
      "This membership payment was cancelled or replaced by a newer purchase and cannot be completed. Please contact Sculpt LAB."
    );
    this.name = "PaidFailedPurchaseError";
    this.paymentReference = paymentReference;
  }
}




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
   * First find an ACTIVE membership whose validity period has not
   * expired. A row already replaced by an earlier upgrade is
   * EXPIRED but can still have a future expiry date, so the status
   * check stops it from being upgraded (and its credits carried)
   * a second time.
   */
  let currentMembership = await prisma.memberMembership.findFirst({
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

  /*
   * Preview using the same rule completion applies: every
   * membership of this type the member still holds is replaced, its
   * unused credits carried and its usage kept. Completion
   * recalculates this when payment is verified.
   */
  const chain = await this.getValidityChain(
    prisma,
    userId,
    currentMembership.membership.type,
    now
  );

  const carriedCredits = chain.rows.reduce(
    (total, row) =>
      total + Math.max((row.creditsTotal ?? 0) - row.creditsUsed, 0),
    0
  );

  const previousCreditsUsed = chain.rows.reduce(
    (total, row) => total + row.creditsUsed,
    0
  );

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
   * Supersede every earlier pending upgrade by this member, for any
   * target. Only the newest upgrade attempt can complete, so an old
   * payment link can't later apply a stale upgrade on top of this one.
   *
   * The PENDING condition is checked by the UPDATE itself. If an
   * older upgrade is completing right now, its transaction holds the
   * purchase row lock; this update waits, sees it is now PAID, and
   * leaves it alone.
   */
  await prisma.membershipPurchase.updateMany({
    where: {
      userId,
      type: MembershipPurchaseType.UPGRADE,
      paymentStatus: PaymentStatus.PENDING,
    },
    data: {
      paymentStatus: PaymentStatus.FAILED,
    },
  });

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


private getMembershipCredits(
  classLimit: number | null
): number | null {
  return classLimit;
}

/**
 * The member's memberships of one type that still hold validity:
 * ACTIVE and not past their expiry date, oldest first. Rows that
 * have not started (no dates, awaiting their first booking) are
 * included.
 *
 * validUntil is the latest expiry among the started rows, which is
 * where their remaining validity ends. Renewals and upgrades add
 * their duration from there, so buying early never loses days and
 * each purchase adds its duration once.
 */
private async getValidityChain(
  client: Prisma.TransactionClient,
  userId: string,
  type: MembershipType,
  now: Date
) {
  const rows = await client.memberMembership.findMany({
    where: {
      userId,
      status: MembershipStatus.ACTIVE,
      membership: { type },
      OR: [
        { expiryDate: null },
        { expiryDate: { gt: now } },
      ],
    },
    include: {
      membership: true,
      membershipPurchase: {
        select: {
          id: true,
          previousMemberMembershipId: true,
        },
      },
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  const startedRows = rows.filter((row) => row.startDate !== null);

  const startTimes = startedRows.map((row) =>
    (row.startDate as Date).getTime()
  );

  const expiryTimes = startedRows
    .map((row) => row.expiryDate)
    .filter((date): date is Date => date !== null)
    .map((date) => date.getTime());

  return {
    rows,

    // The most recent membership in the chain.
    end: rows.length ? rows[rows.length - 1] : null,

    validFrom: startTimes.length
      ? new Date(Math.min(...startTimes))
      : null,

    validUntil: expiryTimes.length
      ? new Date(Math.max(...expiryTimes))
      : null,
  };
}
async completeMembershipPurchase(
  paymentReference: string,
  options: {
    /**
     * Admin reconciliation only: apply a FAILED purchase whose
     * verified payment was recorded by recordPaymentForFailedPurchase.
     */
    applyPaidFailedPurchase?: boolean;
  } = {}
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
// Lock this purchase. When the webhook and the payment callback
// complete it at the same time, the second waits here, then finds
// the membership the first one created and returns it.
await tx.$queryRaw`
  SELECT id
  FROM "MembershipPurchase"
  WHERE "paymentReference" = ${paymentReference}
  FOR UPDATE
`;

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

// A FAILED purchase was cancelled or replaced by a newer attempt
// (initiateUpgrade and initiateRenewal mark older pending attempts
// FAILED). Paying its old payment link must not apply it on its own.
// The payment callers record it for an admin to refund or apply.
if (purchase.paymentStatus === PaymentStatus.FAILED) {
  if (!options.applyPaidFailedPurchase) {
    console.error(
      "[MEMBERSHIP] Refused to complete a FAILED (cancelled or superseded) purchase:",
      paymentReference
    );

    throw new PaidFailedPurchaseError(paymentReference);
  }

  // Admin reconciliation: only a purchase with a recorded, verified
  // payment can be applied.
  if (
    !purchase.paymentRejectionReason?.startsWith(
      PURCHASE_RECONCILIATION.NEEDS_REVIEW
    )
  ) {
    throw new Error(
      "No verified payment is recorded for this cancelled purchase, so it cannot be applied."
    );
  }

  await tx.membershipPurchase.update({
    where: { id: purchase.id },
    data: {
      paymentRejectionReason: `${PURCHASE_RECONCILIATION.APPLIED} | ${new Date().toISOString()} | ${purchase.paymentRejectionReason}`,
    },
  });
}

// Membership changes for one member run one at a time (see
// BookingService.bookMemberSession). Two upgrades or renewals
// completing together would otherwise read the same memberships and
// carry the same credits or validity twice. Lock order is purchase,
// then member.
if (purchase.userId) {
  await tx.$queryRaw`
    SELECT id
    FROM "User"
    WHERE id = ${purchase.userId}
    FOR UPDATE
  `;
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

  if (!purchase.userId) {
    throw new Error(
      "Upgrade purchase is not linked to a member."
    );
  }

  /*
   * The upgrade replaces every membership of this type the member
   * still holds (ACTIVE and not past its expiry), not only the row
   * chosen when the upgrade started. That includes early renewals
   * waiting their turn, so none of them stays ACTIVE next to the
   * upgraded row.
   */
  const chain = await this.getValidityChain(
    tx,
    purchase.userId,
    currentMembership.membership.type,
    now
  );

  const replacedRows = chain.rows;

  /*
   * Existing credit rule, applied to each replaced row: unused
   * credits carry over and historical usage is kept. Expired rows
   * are not in the chain, so they carry nothing. Each replaced row
   * is expired below in the same transaction, so its credits can
   * only be carried once.
   */
  const remainingCredits = replacedRows.reduce(
    (total, row) =>
      total + Math.max((row.creditsTotal ?? 0) - row.creditsUsed, 0),
    0
  );

  const previousCreditsUsed = replacedRows.reduce(
    (total, row) => total + row.creditsUsed,
    0
  );

  // Preserve historical usage while carrying forward unused credits.
  const newCreditsTotal =
    purchase.membership.classLimit === null
      ? null
      : purchase.membership.classLimit +
        remainingCredits +
        previousCreditsUsed;

  const newCreditsUsed = previousCreditsUsed;

  /*
   * Validity: keep all remaining time and add the upgraded
   * package's full duration.
   *
   * - Started and unexpired: the new expiry is the latest expiry
   *   in the chain plus the upgraded duration. The start date stays
   *   the date the membership actually started.
   * - Not started, or expired: dates stay null and the first booking
   *   starts the upgraded package. For an unstarted chain, that first
   *   booking also adds the duration of each replaced unstarted
   *   package (BookingService follows previousMemberMembershipId).
   *   Expired days are never added.
   *
   * The payment date is never used.
   */
  const unstartedRows = replacedRows.filter(
    (row) => row.startDate === null
  );

  const startDate = chain.validUntil ? chain.validFrom : null;

  let expiryDate: Date | null = null;

  if (chain.validUntil) {
    // Unstarted packages replaced alongside a running membership
    // add their full duration too, so carried credits never arrive
    // without the validity that came with them.
    let validUntil = chain.validUntil;

    for (const row of unstartedRows) {
      validUntil =
        bookingService.calculateMembershipExpiry(
          validUntil,
          row.membership.duration,
          row.membership.period
        ) ?? validUntil;
    }

    expiryDate = bookingService.calculateMembershipExpiry(
      validUntil,
      purchase.membership.duration,
      purchase.membership.period
    );
  } else {
    /*
     * Unstarted chain. The first booking walks back from the upgraded
     * row through previousMemberMembershipId and adds each replaced
     * unstarted package once. Separate membership-only purchases are
     * not linked to each other yet, so link each replaced unstarted
     * row to the one bought before it, in purchase order. A row whose
     * purchase already has a link (a renewal of the row before it)
     * keeps it.
     */
    for (let index = 1; index < unstartedRows.length; index += 1) {
      const rowPurchase = unstartedRows[index].membershipPurchase;

      if (rowPurchase && !rowPurchase.previousMemberMembershipId) {
        await tx.membershipPurchase.update({
          where: { id: rowPurchase.id },
          data: {
            previousMemberMembershipId: unstartedRows[index - 1].id,
          },
        });
      }
    }
  }

  /*
   * Expire every replaced row, plus the row the upgrade was started
   * from, which may already be past its expiry and so not be in the
   * chain.
   */
  await tx.memberMembership.updateMany({
    where: {
      id: {
        in: [
          ...new Set([
            currentMembership.id,
            ...replacedRows.map((row) => row.id),
          ]),
        ],
      },
      userId: purchase.userId,
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

        // Link to the most recent replaced row. For an unstarted
        // chain, the first booking follows these links to add each
        // replaced package's duration.
        previousMemberMembershipId:
          chain.end?.id ?? currentMembership.id,
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

    // Same duration rules as first-booking activation, which
    // support every configured plan (Single, Annual, Package, ...).
    expiryDate = bookingService.calculateMembershipExpiry(
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

      if (!purchase.userId) {
        throw new Error(
          "Renewal purchase is not linked to a member."
        );
      }

      /*
       * Renewal adds the new package's full duration to the validity
       * the member still holds for this membership type:
       *
       * - Started and unexpired: the renewal starts at the latest
       *   expiry in the chain, so repeated early renewals each add
       *   their duration once, one after another.
       * - Not started yet: dates stay null. The first booking starts
       *   the original package, then this renewal right after it
       *   (BookingService follows previousMemberMembershipId).
       * - Expired: no expired days are kept. Dates stay null and the
       *   first booking starts the renewal.
       *
       * The payment date is never used as the start. The existing
       * membership is left ACTIVE until its own expiry, as before.
       */
      const chain = await this.getValidityChain(
        tx,
        purchase.userId,
        purchase.membership.type,
        now
      );

      const startDate = chain.validUntil;

      const expiryDate = chain.validUntil
        ? bookingService.calculateMembershipExpiry(
            chain.validUntil,
            purchase.membership.duration,
            purchase.membership.period
          )
        : null;

      const creditsTotal =
        this.getMembershipCredits(
          purchase.membership.classLimit
        );

      /*
       * Memberships of this type whose validity has ended are marked
       * expired. Ones still running stay ACTIVE until their own
       * expiry date.
       */
      await tx.memberMembership.updateMany({
        where: {
          userId: purchase.userId,
          status: MembershipStatus.ACTIVE,
          membership: {
            type: purchase.membership.type,
          },
          expiryDate: {
            lte: now,
          },
        },

        data: {
          status:
            MembershipStatus.EXPIRED,
        },
      });

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

      // Link the renewal to the membership it follows. When that
      // membership is unstarted, its first booking uses this link to
      // start the renewal right after it.
      if (chain.end) {
        await tx.membershipPurchase.update({
          where: {
            id: purchase.id,
          },
          data: {
            previousMemberMembershipId: chain.end.id,
          },
        });
      }

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


// =========================================================
// PAYMENTS FOR CANCELLED OR SUPERSEDED PURCHASES
// =========================================================

/**
 * Record a verified payment for a FAILED (cancelled or superseded)
 * purchase so the customer is not silently left without their money
 * or their membership. The purchase stays FAILED and is flagged for
 * an admin to refund or apply, and every admin is notified.
 *
 * Safe to call repeatedly (provider retries, or webhook plus
 * callback): the purchase row is locked, it is flagged only once, and
 * the notification is de-duplicated by its event key.
 */
async recordPaymentForFailedPurchase(
  paymentReference: string,
  source: "payment-callback" | "webhook"
) {
  const recorded = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id
      FROM "MembershipPurchase"
      WHERE "paymentReference" = ${paymentReference}
      FOR UPDATE
    `;

    const purchase = await tx.membershipPurchase.findUnique({
      where: { paymentReference },
      include: { membership: true },
    });

    if (!purchase || purchase.paymentStatus !== PaymentStatus.FAILED) {
      return null;
    }

    const reason = purchase.paymentRejectionReason ?? "";
    const alreadyRecorded = Object.values(PURCHASE_RECONCILIATION).some(
      (state) => reason.startsWith(state)
    );

    if (!alreadyRecorded) {
      await tx.membershipPurchase.update({
        where: { id: purchase.id },
        data: {
          paymentRejectionReason: [
            PURCHASE_RECONCILIATION.NEEDS_REVIEW,
            new Date().toISOString(),
            source,
            ...(reason ? [`previous: ${reason}`] : []),
          ].join(" | "),
        },
      });
    }

    return purchase;
  });

  if (!recorded) {
    return null;
  }

  console.error(
    "[MEMBERSHIP] Verified payment received for a cancelled or superseded purchase. Refund it or apply it from the admin reconciliation list.",
    {
      paymentReference,
      purchaseId: recorded.id,
      userId: recorded.userId,
      type: recorded.type,
      amount: recorded.amount,
      source,
    }
  );

  try {
    await adminNotificationService.createForAllAdmins({
      eventKey: `paid-failed-purchase:${paymentReference}`,
      type: "PAYMENT",
      title: "Membership payment needs reconciliation",
      message: `${recorded.fullName || recorded.email} paid ₦${recorded.amount.toLocaleString()} for a ${recorded.type.toLowerCase()} purchase (${recorded.membership.name}) that had been cancelled or replaced. Refund it or apply it.`,
      data: {
        reference: paymentReference,
        purchaseId: recorded.id,
        paymentType: `Membership ${recorded.type}`,
        amount: String(recorded.amount),
        source,
      },
    });
  } catch (error) {
    // The purchase is already flagged in the database; the admin
    // reconciliation list still shows it.
    console.error(
      "[MEMBERSHIP] Reconciliation flagged, but admin notification failed:",
      paymentReference,
      error
    );
  }

  return {
    purchaseId: recorded.id,
    paymentReference,
    status: PURCHASE_RECONCILIATION.NEEDS_REVIEW,
  };
}

/** FAILED purchases with a verified payment still to resolve. */
async getPurchasesNeedingReconciliation() {
  return prisma.membershipPurchase.findMany({
    where: {
      paymentStatus: PaymentStatus.FAILED,
      paymentRejectionReason: {
        startsWith: PURCHASE_RECONCILIATION.NEEDS_REVIEW,
      },
    },
    include: {
      membership: true,
      user: {
        select: { id: true, fullName: true, email: true, phone: true },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
}

/**
 * Admin: apply a paid, cancelled purchase as if it had completed.
 * It goes through the normal completion, with its locks and rules;
 * an upgrade applies on top of the member's current membership.
 */
async applyPaidFailedPurchase(purchaseId: string) {
  const purchase = await prisma.membershipPurchase.findUnique({
    where: { id: purchaseId },
  });

  if (!purchase) {
    throw new Error("Membership purchase not found.");
  }

  return this.completeMembershipPurchase(purchase.paymentReference, {
    applyPaidFailedPurchase: true,
  });
}

/**
 * Admin: record that a paid, cancelled purchase was refunded to the
 * customer (the refund itself is issued in the Paymish dashboard).
 * The purchase stays FAILED.
 */
async markPaidFailedPurchaseRefunded(purchaseId: string, note?: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id
      FROM "MembershipPurchase"
      WHERE id = ${purchaseId}
      FOR UPDATE
    `;

    const purchase = await tx.membershipPurchase.findUnique({
      where: { id: purchaseId },
    });

    if (!purchase) {
      throw new Error("Membership purchase not found.");
    }

    if (
      purchase.paymentStatus !== PaymentStatus.FAILED ||
      !purchase.paymentRejectionReason?.startsWith(
        PURCHASE_RECONCILIATION.NEEDS_REVIEW
      )
    ) {
      throw new Error(
        "Only a cancelled purchase with a recorded payment awaiting reconciliation can be marked refunded."
      );
    }

    return tx.membershipPurchase.update({
      where: { id: purchase.id },
      data: {
        paymentRejectionReason: [
          PURCHASE_RECONCILIATION.REFUNDED,
          new Date().toISOString(),
          note?.trim() || "Refunded",
          purchase.paymentRejectionReason,
        ].join(" | "),
      },
    });
  });
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