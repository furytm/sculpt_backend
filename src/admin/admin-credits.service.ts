/**
 * Admin removal of unused credits: from one MemberMembership
 * (removeCredits) or across a member's GROUP/PRIVATE pool (removePoolCredits).
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
import { BookingStatus, MembershipStatus, MembershipType, Prisma } from "@prisma/client";
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

  /**
   * Removes unused credits from a member's whole pool of one type (GROUP
   * or PRIVATE), spread across its eligible MemberMembership rows. The
   * pool is what the admin members list shows: the member's ACTIVE,
   * unexpired rows of that type (see getAllMembers). `expectedRemaining`
   * is that combined balance.
   *
   * Same credit rule as removeCredits, per row: only creditsTotal is
   * lowered, never below creditsUsed; dates, status, other rows, other
   * types and bookings are untouched. All rows change in one transaction
   * or none do.
   */
  async removePoolCredits(input: RemovePoolCreditsInput) {
    return runPoolRemoval(input, true);
  },

  /**
   * Read-only preview of removePoolCredits: the same eligibility, checks
   * (including STALE_BALANCE against expectedRemaining) and allocation, and
   * the same result shape, but no locks and no writes. Advisory only: the
   * removal re-validates everything.
   */
  async previewPoolCredits(input: RemovePoolCreditsInput) {
    return runPoolRemoval(input, false);
  },
};

/** Shared by removePoolCredits (commit) and previewPoolCredits (no writes). */
async function runPoolRemoval(input: RemovePoolCreditsInput, commit: boolean) {
    const { memberId, membershipType, credits, expectedRemaining } = input;

    // Which pool: a registered member's rows, or an offline membership
    // (no account), which is its own one-row pool, addressed by its ID as
    // in removeCredits. Read outside the transaction only to know what to lock.
    const user = await prisma.user.findUnique({ where: { id: memberId }, select: { id: true } });
    const offline = user
      ? null
      : await prisma.memberMembership.findUnique({ where: { id: memberId }, select: { id: true, userId: true } });

    if (!user && (!offline || offline.userId !== null)) {
      throw new CreditAdjustmentError(404, "MEMBER_NOT_FOUND", "Member not found.");
    }

    const userId = user?.id ?? null;
    const owner: Prisma.MemberMembershipWhereInput = userId ? { userId } : { id: memberId, userId: null };

    return prisma.$transaction(
      async (tx) => {
        // Lock order as everywhere else: the member's account first (the
        // lock bookings, renewals and upgrades take, so none of them can
        // change this pool meanwhile), then the pool's rows by ID.
        // A preview takes no locks.
        if (commit && userId) {
          await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
        }

        const now = new Date();
        const eligible: Prisma.MemberMembershipWhereInput = {
          ...owner,
          status: MembershipStatus.ACTIVE,
          membership: { type: membershipType },
          OR: [{ expiryDate: null }, { expiryDate: { gt: now } }],
        };

        const candidates = await tx.memberMembership.findMany({
          where: eligible,
          select: { id: true },
          orderBy: { id: "asc" },
        });

        if (candidates.length === 0) {
          throw new CreditAdjustmentError(
            409,
            "MEMBERSHIP_NOT_ACTIVE",
            `This member has no active, unexpired ${membershipType.toLowerCase()} membership.`
          );
        }

        const ids = candidates.map((row) => row.id);
        if (commit) {
          await tx.$queryRaw`SELECT id FROM "MemberMembership" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
        }

        // Re-read under the locks, re-checking eligibility.
        const rows = await tx.memberMembership.findMany({
          where: { ...eligible, id: { in: ids } },
          include: {
            membership: { select: { id: true, name: true, type: true } },
            // Only to tell whether the row has had its first session
            // booked (BookingService.isAwaitingFirstBooking).
            bookings: {
              where: { bookingStatus: BookingStatus.CONFIRMED, sessionId: { not: null } },
              select: { id: true },
              take: 1,
            },
          },
          orderBy: { id: "asc" },
        });

        if (rows.length === 0) {
          throw new CreditAdjustmentError(
            409,
            "MEMBERSHIP_NOT_ACTIVE",
            `This member has no active, unexpired ${membershipType.toLowerCase()} membership.`
          );
        }

        // Any unlimited row makes the pool unlimited (as the admin list shows it).
        if (rows.some((row) => row.creditsTotal === null)) {
          throw new CreditAdjustmentError(
            409,
            "UNLIMITED_MEMBERSHIP",
            "This member's membership of this type has unlimited credits; there are no credits to remove."
          );
        }

        const poolBefore = rows.reduce((total, row) => total + balance(row).remainingCredits, 0);

        if (poolBefore !== expectedRemaining) {
          throw new CreditAdjustmentError(
            409,
            "STALE_BALANCE",
            `This member's ${membershipType.toLowerCase()} balance has changed (now ${poolBefore} remaining). Refresh and try again.`
          );
        }

        if (credits > poolBefore) {
          throw new CreditAdjustmentError(
            400,
            "INSUFFICIENT_CREDITS",
            `Only ${poolBefore} unused credit${poolBefore === 1 ? "" : "s"} can be removed.`
          );
        }

        const plan = allocatePoolRemoval(
          rows.map((row) => ({
            id: row.id,
            remaining: balance(row).remainingCredits,
            started: !isAwaitingFirstBooking(row),
            expiryDate: row.expiryDate,
            createdAt: row.createdAt,
          })),
          credits
        );

        const byId = new Map(rows.map((row) => [row.id, row]));
        const allocations = [];

        for (const { id, credits: take } of plan) {
          const row = byId.get(id)!;
          const creditsTotal = row.creditsTotal as number;

          // Conditional on the values just validated; any miss rolls back
          // every row changed so far. A preview writes nothing.
          const updated = commit
            ? await tx.memberMembership.updateMany({
                where: { id, status: MembershipStatus.ACTIVE, creditsTotal, creditsUsed: row.creditsUsed },
                data: { creditsTotal: creditsTotal - take },
              })
            : { count: 1 };

          if (updated.count !== 1) {
            throw new CreditAdjustmentError(
              409,
              "STALE_BALANCE",
              "This member's balance has changed. Refresh and try again."
            );
          }

          allocations.push({
            memberMembershipId: row.id,
            membershipId: row.membershipId,
            membershipName: row.membership.name,
            creditsRemoved: take,
            previous: balance(row),
            updated: balance({ creditsTotal: creditsTotal - take, creditsUsed: row.creditsUsed }),
            startDate: row.startDate,
            expiryDate: row.expiryDate,
            status: row.status,
          });
        }

        return {
          memberId,
          userId,
          membershipType,
          creditsRemoved: credits,
          previous: { poolRemaining: poolBefore },
          updated: { poolRemaining: poolBefore - credits },
          recordsInPool: rows.length,
          allocations,
        };
      },
      { maxWait: 10000, timeout: 15000 }
    );
}

export interface RemovePoolCreditsInput {
  /** A User ID, or an offline membership's own ID (as in removeCredits). */
  memberId: string;
  membershipType: MembershipType;
  credits: number;
  /** The combined remaining balance of the pool the admin saw. */
  expectedRemaining: number;
}

/**
 * Same rule as BookingService.isAwaitingFirstBooking: no start date and
 * no confirmed booking for an actual session yet. (The caller loads only
 * confirmed bookings that have a session.)
 */
function isAwaitingFirstBooking(row: { startDate: Date | null; bookings: unknown[] }) {
  return row.startDate === null && row.bookings.length === 0;
}

export interface PoolRow {
  id: string;
  /** max(creditsTotal - creditsUsed, 0) */
  remaining: number;
  /** false while the row awaits its first booked session */
  started: boolean;
  expiryDate: Date | null;
  createdAt: Date;
}

/**
 * Which rows lose how many credits. Pure; `credits` must not exceed the
 * pool total. Mirrors the order bookings consume credits in:
 *
 * 1. Started rows, soonest expiry first; rows with no expiry after the
 *    dated ones (ties: oldest first, then ID).
 * 2. Rows awaiting their first booking last, oldest first. A booking
 *    starts the OLDEST awaiting row that has a credit, and that start
 *    carries any queued renewals behind it. So an older awaiting row is
 *    never emptied while a newer one keeps credits: the first pass takes
 *    each awaiting row down to 1 credit (oldest first), and only then are
 *    the last credits taken, newest row first.
 *
 * Returns only rows that lose at least one credit, in the order taken.
 */
export function allocatePoolRemoval(rows: PoolRow[], credits: number): { id: string; credits: number }[] {
  const byAge = (a: PoolRow, b: PoolRow) =>
    a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  const started = rows
    .filter((row) => row.started)
    .sort((a, b) => {
      if (a.expiryDate && b.expiryDate) {
        return a.expiryDate.getTime() - b.expiryDate.getTime() || byAge(a, b);
      }
      if (a.expiryDate) return -1;
      if (b.expiryDate) return 1;
      return byAge(a, b);
    });
  const awaiting = rows.filter((row) => !row.started).sort(byAge);

  const taken = new Map<string, number>();
  const order: string[] = [];
  let left = credits;

  const take = (row: PoolRow, limit: number) => {
    const already = taken.get(row.id) ?? 0;
    const amount = Math.min(left, Math.max(limit - already, 0));
    if (amount <= 0) return;
    if (!taken.has(row.id)) order.push(row.id);
    taken.set(row.id, already + amount);
    left -= amount;
  };

  for (const row of started) take(row, row.remaining);
  for (const row of awaiting) take(row, row.remaining - 1);
  for (const row of [...awaiting].reverse()) take(row, row.remaining);

  if (left > 0) {
    throw new CreditAdjustmentError(400, "INSUFFICIENT_CREDITS", "Not enough unused credits to remove.");
  }

  return order.map((id) => ({ id, credits: taken.get(id)! }));
}
