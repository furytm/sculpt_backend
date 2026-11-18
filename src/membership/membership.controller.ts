import { Request, Response } from "express";
import membershipService from "./membership.service.js";
import { MembershipType } from "@prisma/client";
import activityLog from "../activity-log/activity-log.service.js";
import { ActivityAction } from "../activity-log/activity-log.types.js";
import { describeError, ErrorDescription, sendErrorResponse } from "../observability/errors.js";
import { logger } from "../observability/logger.js";

// ---------------------------------------------------------------------
// Activity logging for purchase, upgrade and renewal. Records only; it
// never changes a response. "PAYMENT_INITIALIZED" means a payment URL
// was returned: the purchase completes only after a verified payment.
// ---------------------------------------------------------------------

type PurchaseAction = Extract<ActivityAction, "membership.purchase" | "membership.upgrade" | "membership.renewal">;

/**
 * Metadata, or a function building it. A function is evaluated inside
 * the helper's guard, so reading fields of a service result can never
 * throw into the business operation.
 */
type MetadataSource = Record<string, unknown> | (() => Record<string, unknown>);

const readMetadata = (source: MetadataSource) =>
  typeof source === "function" ? source() : source;

/** The submitted email, for identifying a guest; never throws. */
function guestEmailFrom(body: unknown): string | null {
  try {
    const email = (body as { email?: unknown } | null | undefined)?.email;
    return typeof email === "string" ? email : null;
  } catch {
    return null;
  }
}

/** Runs a logging helper best-effort: any failure is swallowed. */
function bestEffort(work: () => void) {
  try {
    work();
  } catch {
    // Logging must never change the outcome of the business operation.
  }
}

function recordValidationFailure(
  action: PurchaseAction,
  userId: string | null,
  message: string,
  missingFields: string,
  subjectEmail?: string | null
) {
  bestEffort(() =>
    activityLog.record({
      action,
      stage: "VALIDATION_FAILED",
      status: "FAILURE",
      actorType: userId ? "MEMBER" : "GUEST",
      userId,
      subjectEmail,
      errorCode: "VALIDATION_ERROR",
      errorMessage: message,
      httpStatus: 400,
      metadata: { missingFields },
    })
  );
}

function recordInitiated(
  action: PurchaseAction,
  userId: string | null,
  metadata: MetadataSource,
  subjectEmail?: string | null
) {
  bestEffort(() =>
    activityLog.record({
      action,
      stage: "INITIATED",
      status: "INFO",
      actorType: userId ? "MEMBER" : "GUEST",
      userId,
      subjectEmail,
      metadata: readMetadata(metadata),
    })
  );
}

function recordPaymentInitialized(
  action: PurchaseAction,
  userId: string | null,
  result: { purchaseId?: string; reference?: string; amount?: number; reusedPendingPurchase?: boolean } | null | undefined,
  metadata: MetadataSource,
  subjectEmail?: string | null
) {
  bestEffort(() =>
    activityLog.record({
      action,
      stage: "PAYMENT_INITIALIZED",
      status: "INFO",
      actorType: userId ? "MEMBER" : "GUEST",
      userId,
      subjectEmail,
      entityType: "MEMBERSHIP_PURCHASE",
      entityId: result?.purchaseId ?? null,
      paymentReference: result?.reference ?? null,
      description: "Payment link created; awaiting the customer's payment.",
      metadata: {
        ...readMetadata(metadata),
        purchaseId: result?.purchaseId,
        amount: result?.amount,
        reusedPendingPurchase: result?.reusedPendingPurchase,
      },
    })
  );
}

function recordFailure(
  action: PurchaseAction,
  userId: string | null,
  description: ErrorDescription,
  metadata: MetadataSource,
  subjectEmail?: string | null
) {
  bestEffort(() =>
    logger.error(`${action}.failed`, {
      errorCode: description.code,
      errorKind: description.kind,
      errorMessage: description.logMessage,
      // Server logs only; never sent to the browser or the activity log.
      stack: description.logStack,
    })
  );

  bestEffort(() =>
    activityLog.record({
      action,
      stage: description.kind === "provider" ? "PROVIDER_FAILED" : "FAILED",
      status: "FAILURE",
      actorType: userId ? "MEMBER" : "GUEST",
      userId,
      subjectEmail,
      errorCode: description.code,
      errorMessage: description.logMessage,
      httpStatus: description.httpStatus,
      metadata: { ...readMetadata(metadata), errorKind: description.kind, ...description.logFields },
    })
  );
}

class MembershipController {
  /**
   * GET /api/memberships
   */
   async getMemberships(req: Request, res: Response) {
    try {
      const type = req.query.type as MembershipType | undefined;

      const memberships = await membershipService.getAllMemberships(type);

      return res.status(200).json({
        success: true,
        message: "Memberships retrieved successfully.",
        data: memberships,
      });
    } catch (error: any) {
      console.error("Get Memberships Error:", error);

      return res.status(500).json({
        success: false,
        message: error?.message || "Failed to retrieve memberships.",
      });
    }
  }


  /**
   * GET /api/memberships/:id
   */
  async getMembership(req: Request<{ id: string }>, res: Response) {
    try {
      const { id } = req.params;

      const membership = await membershipService.getMembershipById(id);

      if (!membership) {
        return res.status(404).json({
          success: false,
          message: "Membership not found.",
        });
      }

      return res.status(200).json({
        success: true,
        data: membership,
      });
    } catch (error: any) {
      console.error("Get Membership Error:", error);

      return res.status(500).json({
        success: false,
        message: error?.message || "Failed to retrieve membership.",
      });
    }
  }

  /**
   * POST /api/memberships
   */
  async createMembership(req: Request, res: Response) {
    try {
      const membership = await membershipService.createMembership(req.body);

      return res.status(201).json({
        success: true,
        message: "Membership created successfully.",
        data: membership,
      });
    } catch (error: any) {
      console.error("Create Membership Error:", error);

      return res.status(400).json({
        success: false,
        message: error?.message || "Failed to create membership.",
      });
    }
  }

  /**
   * PATCH /api/memberships/:id
   */
  async updateMembership(req: Request<{ id: string }>, res: Response) {
    try {
      const { id } = req.params;

      const membership = await membershipService.updateMembership(
        id,
        req.body
      );

      return res.status(200).json({
        success: true,
        message: "Membership updated successfully.",
        data: membership,
      });
    } catch (error: any) {
      console.error("Update Membership Error:", error);

      return res.status(400).json({
        success: false,
        message: error?.message || "Failed to update membership.",
      });
    }
  }

  /**
   * DELETE /api/memberships/:id
   * Soft delete (isActive = false)
   */
  async deleteMembership(req: Request<{ id: string }>, res: Response) {
    try {
      const { id } = req.params;

      await membershipService.deleteMembership(id);

      return res.status(200).json({
        success: true,
        message: "Membership deactivated successfully.",
      });
    } catch (error: any) {
      console.error("Delete Membership Error:", error);

      return res.status(400).json({
        success: false,
        message: error?.message || "Failed to deactivate membership.",
      });
    }
  }


  async upgradeMembership(req: Request, res: Response) {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        message: "Authentication required.",
      });
    }

    const { membershipId } = req.body;

    if (!membershipId) {
      recordValidationFailure("membership.upgrade", userId, "Target membership ID is required.", "membershipId");

      return res.status(400).json({
        message:
          "Target membership ID is required.",
      });
    }

    recordInitiated("membership.upgrade", userId, { targetMembershipId: membershipId });

    const result =
      await membershipService.initiateUpgrade(
        userId,
        membershipId
      );

    // A function: read inside the helper's guard, never here.
    recordPaymentInitialized("membership.upgrade", userId, result, () => ({
      targetMembershipId: membershipId,
      carriedCredits: result.carriedCredits,
      newCreditsTotal: result.newCreditsTotal,
    }));

    return res.status(200).json({
      message:
        "Membership upgrade payment initialized.",
      ...result,
    });
  } catch (error: unknown) {
    const description = describeError(error);
    recordFailure("membership.upgrade", req.user?.userId ?? null, description, () => ({
      targetMembershipId: req.body?.membershipId,
    }));

    return sendErrorResponse(res, description, {}, "Unable to initialize membership upgrade.");
  }
}

async renewMembership(req: Request, res: Response) {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        message: "Authentication required.",
      });
    }

    const { membershipId } = req.body;
    // Optional and additive: which of the member's memberships to renew.
    const memberMembershipId =
      typeof req.body?.memberMembershipId === "string" && req.body.memberMembershipId
        ? req.body.memberMembershipId
        : undefined;

    recordInitiated("membership.renewal", userId, { membershipId });

    const result =
      await membershipService.initiateRenewal(
        userId,
        membershipId,
        memberMembershipId
      );

    recordPaymentInitialized("membership.renewal", userId, result, { membershipId });

    return res.status(200).json({
      message:
        "Membership renewal payment initialized.",
      ...result,
    });
  } catch (error: unknown) {
    const description = describeError(error);
    recordFailure("membership.renewal", req.user?.userId ?? null, description, () => ({
      membershipId: req.body?.membershipId,
    }));

    return sendErrorResponse(res, description, {}, "Unable to initialize membership renewal.");
  }
}

async getMembershipPurchase(
  req: Request<{ reference: string }>,
  res: Response
) {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const { reference } = req.params;

    if (!reference) {
      return res.status(400).json({
        success: false,
        message: "Payment reference is required.",
      });
    }

    const result =
      await membershipService.getMembershipPurchase(
        userId,
        reference
      );

    if (!result) {
      return res.status(404).json({
        success: false,
        message: "Membership purchase not found.",
      });
    }

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error(
      "Get Membership Purchase Error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error?.message ||
        "Failed to retrieve membership purchase.",
    });
  }
}


async getPublicMembershipConfirmation(
  req: Request<{ reference: string }>,
  res: Response
) {
  try {
    const { reference } = req.params;

    if (!reference) {
      return res.status(400).json({
        success: false,
        message: "Payment reference is required.",
      });
    }

    const result =
      await membershipService.getPublicMembershipConfirmation(
        reference
      );

    if (!result) {
      return res.status(404).json({
        success: false,
        message: "Membership purchase not found.",
      });
    }

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error(
      "Get Public Membership Confirmation Error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error?.message ||
        "Failed to retrieve membership confirmation.",
    });
  }

  
}


async initiateOfflineMembershipPurchase(
  req: Request,
  res: Response
) {
  try {
    const {
      membershipId,
      fullName,
      email,
      phone,
      firstSessionId,
      firstClassId,
      healthDeclarationAccepted,
      healthDeclarationNotes,
    } = req.body;

    if (
      !membershipId ||
      !fullName?.trim() ||
      !email?.trim() ||
      !phone?.trim()
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Membership, full name, email, and phone are required.",
      });
    }

    const userId = req.user?.userId ?? null;

    const result =
      await membershipService.initiateOfflineMembershipPurchase({
        membershipId,
        fullName,
        email,
        phone,
        userId,
        firstSessionId: firstSessionId || null,
        firstClassId: firstClassId || null,
        healthDeclarationAccepted:
          healthDeclarationAccepted ?? false,
        healthDeclarationNotes:
          healthDeclarationNotes || null,
      });

    return res.status(201).json({
      success: true,
      message:
        "Offline membership purchase created. Please complete your bank transfer.",
      data: result,
    });
  } catch (error: any) {
    console.error(
      "Initiate Offline Membership Purchase Error:",
      error
    );

    return res.status(400).json({
      success: false,
      message:
        error?.message ||
        "Unable to initiate offline membership purchase.",
    });
  }
}

}

export const purchaseNewMembership = async (
  req: Request,
  res: Response
) => {
  try {
    const {
      membershipId,
      fullName,
      email,
      phone,
      firstSessionId,
      firstClassId,
      healthDeclaration,
    } = req.body;

    const userId = req.user?.userId ?? null;
    const guestEmail = typeof email === "string" ? email : null;

    if (
      !membershipId ||
      !fullName?.trim() ||
      !email?.trim() ||
      !phone?.trim()
    ) {
      recordValidationFailure(
        "membership.purchase",
        userId,
        "Membership, name, email, and phone are required.",
        [
          !membershipId && "membershipId",
          !fullName?.trim() && "fullName",
          !email?.trim() && "email",
          !phone?.trim() && "phone",
        ].filter(Boolean).join(","),
        guestEmail
      );

      return res.status(400).json({
        success: false,
        message:
          "Membership, name, email, and phone are required.",
      });
    }

    if (
      firstSessionId &&
      healthDeclaration?.accepted !== true
    ) {
      recordValidationFailure(
        "membership.purchase",
        userId,
        "You must accept the Health Declaration when selecting your first session.",
        "healthDeclaration",
        guestEmail
      );

      return res.status(400).json({
        success: false,
        message:
          "You must accept the Health Declaration when selecting your first session.",
      });
    }

    const purchaseMetadata = {
      membershipId,
      hasFirstSession: Boolean(firstSessionId),
      signedIn: Boolean(userId),
    };

    recordInitiated("membership.purchase", userId, purchaseMetadata, guestEmail);

    const result =
      await membershipService.initiateNewMembershipPurchase({
        membershipId,
        fullName,
        email,
        phone,
        userId: req.user?.userId ?? null,
        firstSessionId: firstSessionId || null,
        firstClassId: firstClassId || null,
        healthDeclarationAccepted:
          healthDeclaration?.accepted === true,
        healthDeclarationNotes:
          healthDeclaration?.notes || null,
      });

    recordPaymentInitialized("membership.purchase", userId, result, purchaseMetadata, guestEmail);

    return res.status(201).json({
      success: true,
      message: "Membership payment initialized.",
      data: result,
    });
  } catch (error) {
    const description = describeError(error);
    recordFailure(
      "membership.purchase",
      req.user?.userId ?? null,
      description,
      () => ({ membershipId: req.body?.membershipId }),
      guestEmailFrom(req.body)
    );

    return sendErrorResponse(
      res,
      description,
      { success: false },
      "Could not initialize membership payment."
    );
  }
};




export default new MembershipController();