import { Request, Response } from "express";
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
};
