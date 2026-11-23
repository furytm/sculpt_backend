/**
 * Admin removal of unused credits from one MemberMembership.
 *
 * Credit model (unchanged): remaining = max(creditsTotal - creditsUsed, 0)
 * per membership row, creditsTotal null = unlimited, and pools are the
 * sum of rows of one type. creditsUsed means credits spent on bookings:
 * cancellation gives a credit back by lowering it, and upgrades keep it
 * as historical usage. So removing credits LOWERS creditsTotal and never
 * touches creditsUsed, the dates, other rows or bookings. Every view
 * (member summary, admin pools, upgrade carry-over, booking eligibility)
 * reads the new balance from the row.
 */
import { MembershipStatus } from "@prisma/client";
import prisma from "../config/prisma.js";

export class CreditAdjustmentError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "CreditAdjustmentError";
  }
}

export interface RemoveCreditsInput {
  /** The member from the route: a User ID, or an offline membership's own ID. */
  memberId: string;
  memberMembershipId: string;
  credits: number;
  /** The remaining balance the admin saw; a different balance is refused. */
  expectedRemaining: number;
}

const balance = (row: { creditsTotal: number | null; creditsUsed: number }) => ({
  creditsTotal: row.creditsTotal,
  creditsUsed: row.creditsUsed,
  remainingCredits: Math.max((row.creditsTotal ?? 0) - row.creditsUsed, 0),
});

export const adminCreditsService = {
  async removeCredits(input: RemoveCreditsInput) {
    const { memberId, memberMembershipId, credits, expectedRemaining } = input;

    // Read once outside the transaction only to know which account to lock.
    const located = await prisma.memberMembership.findUnique({
      where: { id: memberMembershipId },
      select: { id: true, userId: true },
    });

    // Ownership: the row must belong to the member in the route. Offline
    // memberships have no account and are addressed by their own ID.
    const owned =
      located &&
      (located.userId ? located.userId === memberId : located.id === memberId);

    if (!located || !owned) {
      throw new CreditAdjustmentError(404, "MEMBERSHIP_NOT_FOUND", "Membership not found for this member.");
    }

    return prisma.$transaction(
      async (tx) => {
        // Same lock the booking, renewal and upgrade paths take, so a
        // concurrent booking can't spend a credit being removed. Then the
        // row itself (offline memberships have no account to lock).
        if (located.userId) {
          await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${located.userId} FOR UPDATE`;
        }
        await tx.$queryRaw`SELECT id FROM "MemberMembership" WHERE id = ${memberMembershipId} FOR UPDATE`;

        const row = await tx.memberMembership.findUnique({
          where: { id: memberMembershipId },
          include: { membership: { select: { id: true, name: true, type: true } } },
        });

        if (!row || row.userId !== located.userId) {
          throw new CreditAdjustmentError(404, "MEMBERSHIP_NOT_FOUND", "Membership not found for this member.");
        }

        const now = new Date();
        if (row.status !== MembershipStatus.ACTIVE || (row.expiryDate !== null && row.expiryDate <= now)) {
          throw new CreditAdjustmentError(
            409,
            "MEMBERSHIP_NOT_ACTIVE",
            "Credits can only be removed from an active, unexpired membership."
          );
        }

        if (row.creditsTotal === null) {
          throw new CreditAdjustmentError(
            409,
            "UNLIMITED_MEMBERSHIP",
            "This membership has unlimited credits; there are no credits to remove."
          );
        }

        const before = balance(row);

        if (before.remainingCredits !== expectedRemaining) {
          throw new CreditAdjustmentError(
            409,
            "STALE_BALANCE",
            `This membership's balance has changed (now ${before.remainingCredits} remaining). Refresh and try again.`
          );
        }

        if (credits > before.remainingCredits) {
          throw new CreditAdjustmentError(
            400,
            "INSUFFICIENT_CREDITS",
            `Only ${before.remainingCredits} unused credit${before.remainingCredits === 1 ? "" : "s"} can be removed.`
          );
        }

        // Conditional on the values just validated (belt and braces under the lock).
        const updated = await tx.memberMembership.updateMany({
          where: { id: row.id, creditsTotal: row.creditsTotal, creditsUsed: row.creditsUsed },
          data: { creditsTotal: row.creditsTotal - credits },
        });

        if (updated.count !== 1) {
          throw new CreditAdjustmentError(409, "STALE_BALANCE", "This membership's balance has changed. Refresh and try again.");
        }

        const after = balance({ creditsTotal: row.creditsTotal - credits, creditsUsed: row.creditsUsed });

        return {
          memberMembershipId: row.id,
          userId: row.userId,
          membershipId: row.membershipId,
          membershipName: row.membership.name,
          membershipType: row.membership.type,
          creditsRemoved: credits,
          previous: before,
          updated: after,
          startDate: row.startDate,
          expiryDate: row.expiryDate,
          status: row.status,
        };
      },
      { maxWait: 10000, timeout: 15000 }
    );
  },
};
