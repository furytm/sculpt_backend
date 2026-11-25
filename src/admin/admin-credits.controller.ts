import { MembershipType } from "@prisma/client";
import { Request, Response } from "express";
import { logger } from "../observability/logger.js";
import { adminCreditsService, CreditAdjustmentError } from "./admin-credits.service.js";

const isWholeNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value);

function validationError(res: Response, message: string) {
  return res.status(400).json({ success: false, code: "VALIDATION_ERROR", message });
}

export const adminCreditsController = {
  /**
   * POST /api/admin/members/:memberId/memberships/:memberMembershipId/credits/remove
   * Body: { credits: positive whole number, expectedRemaining: whole number >= 0 }
   */
  async removeCredits(req: Request, res: Response) {
    const memberId = String(req.params.memberId ?? "");
    const memberMembershipId = String(req.params.memberMembershipId ?? "");
    const { credits, expectedRemaining } = req.body ?? {};

    if (!isWholeNumber(credits) || credits < 1) {
      return validationError(res, "Credits to remove must be a positive whole number.");
    }

    if (!isWholeNumber(expectedRemaining) || expectedRemaining < 0) {
      return validationError(
        res,
        "expectedRemaining (the remaining balance shown to you) is required and must be a whole number."
      );
    }

    try {
      const result = await adminCreditsService.removeCredits({
        memberId,
        memberMembershipId,
        credits,
        expectedRemaining,
      });

      return res.status(200).json({
        success: true,
        message: `${credits} credit${credits === 1 ? "" : "s"} removed. ${result.updated.remainingCredits} remaining.`,
        data: result,
      });
    } catch (error) {
      if (error instanceof CreditAdjustmentError) {
        return res.status(error.status).json({ success: false, code: error.code, message: error.message });
      }
      console.error("Remove Credits Error:", error);
      return res.status(500).json({ success: false, message: "Unable to remove credits. Please try again." });
    }
  },

  /**
   * POST /api/admin/members/:memberId/credit-pools/:type/credits/remove
   * :type is GROUP or PRIVATE.
   * Body: { credits: positive whole number, expectedRemaining: whole number >= 0 }
   * expectedRemaining is the combined remaining balance of that pool.
   */
  async removePoolCredits(req: Request, res: Response) {
    const input = parsePoolRequest(req, res);
    if (!input) return;
    const { credits } = input;

    try {
      const result = await adminCreditsService.removePoolCredits(input);

      // A second, server-side record of exactly what changed, in case the
      // activity log write (best effort, after the response) is lost.
      logger.info("admin.credit_pool_removal", {
        memberId: result.memberId,
        membershipType: result.membershipType,
        creditsRemoved: result.creditsRemoved,
        previousPoolRemaining: result.previous.poolRemaining,
        poolRemaining: result.updated.poolRemaining,
        allocations: result.allocations.map((item) => ({
          memberMembershipId: item.memberMembershipId,
          creditsRemoved: item.creditsRemoved,
          previousCreditsTotal: item.previous.creditsTotal,
          creditsTotal: item.updated.creditsTotal,
          creditsUsed: item.updated.creditsUsed,
        })),
      });

      return res.status(200).json({
        success: true,
        message: `${credits} credit${credits === 1 ? "" : "s"} removed. ${result.updated.poolRemaining} remaining.`,
        data: result,
      });
    } catch (error) {
      if (error instanceof CreditAdjustmentError) {
        return res.status(error.status).json({ success: false, code: error.code, message: error.message });
      }
      console.error("Remove Pool Credits Error:", error);
      return res.status(500).json({ success: false, message: "Unable to remove credits. Please try again." });
    }
  },

  /**
   * POST /api/admin/members/:memberId/credit-pools/:type/credits/preview
   * Same params, body, checks and `data` shape as removePoolCredits, with
   * no writes: what a removal would do right now. Advisory only.
   */
  async previewPoolCredits(req: Request, res: Response) {
    const input = parsePoolRequest(req, res);
    if (!input) return;
    const { credits } = input;

    try {
      const result = await adminCreditsService.previewPoolCredits(input);
      return res.status(200).json({
        success: true,
        message: `Removing ${credits} credit${credits === 1 ? "" : "s"} would leave ${result.updated.poolRemaining} remaining.`,
        data: result,
      });
    } catch (error) {
      if (error instanceof CreditAdjustmentError) {
        return res.status(error.status).json({ success: false, code: error.code, message: error.message });
      }
      console.error("Preview Pool Credits Error:", error);
      return res.status(500).json({ success: false, message: "Unable to preview the credit removal. Please try again." });
    }
  },
};

/** Validates a pooled request (remove or preview); sends the 400 itself. */
function parsePoolRequest(req: Request, res: Response) {
  const memberId = String(req.params.memberId ?? "");
  const type = String(req.params.type ?? "").toUpperCase();
  const { credits, expectedRemaining } = req.body ?? {};

  if (type !== MembershipType.GROUP && type !== MembershipType.PRIVATE) {
    validationError(res, "Membership type must be GROUP or PRIVATE.");
    return null;
  }

  if (!isWholeNumber(credits) || credits < 1) {
    validationError(res, "Credits to remove must be a positive whole number.");
    return null;
  }

  if (!isWholeNumber(expectedRemaining) || expectedRemaining < 0) {
    validationError(
      res,
      "expectedRemaining (the combined remaining balance shown to you) is required and must be a whole number."
    );
    return null;
  }

  return { memberId, membershipType: type as MembershipType, credits, expectedRemaining };
}
