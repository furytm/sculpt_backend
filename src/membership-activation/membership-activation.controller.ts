import { Request, Response } from "express";
import { membershipActivationService } from "./membership-activation.service.js";

class MembershipActivationController {
  async verify(req: Request, res: Response) {
    try {
      const {
        membershipNumber,
        activationToken,
      } = req.body;

      if (!membershipNumber || !activationToken) {
        return res.status(400).json({
          success: false,
          message:
            "Membership number and activation token are required.",
        });
      }

      const activation =
        await membershipActivationService.verifyActivation({
          membershipNumber,
          activationToken,
        });

      return res.status(200).json({
        success: true,
        message: "Activation verified successfully.",
        data: activation,
      });
    } catch (error: any) {
      console.error("Verify Activation Error:", error);

      return res.status(400).json({
        success: false,
        message:
          error?.message || "Failed to verify activation.",
      });
    }
  }

  async complete(req: Request, res: Response) {
    try {
      const {
        membershipNumber,
        activationToken,
        fullName,
        phone,
        password,
      } = req.body;

      if (
        !membershipNumber ||
        !activationToken ||
        !fullName ||
        !password
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Membership number, activation token, full name and password are required.",
        });
      }

      if (password.length < 8) {
        return res.status(400).json({
          success: false,
          message:
            "Password must be at least 8 characters.",
        });
      }

      const result =
        await membershipActivationService.completeActivation({
          membershipNumber,
          activationToken,
          fullName,
          phone,
          password,
        });

      res.cookie("accessToken", result.accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite:
          process.env.NODE_ENV === "production"
            ? "none"
            : "lax",
        maxAge: 15 * 60 * 1000,
      });

      res.cookie("refreshToken", result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite:
          process.env.NODE_ENV === "production"
            ? "none"
            : "lax",
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });

      return res.status(200).json({
        success: true,
        message:
          "Account created and membership activated successfully.",
        data: {
          user: result.user,
          membership: result.membership,
        },
      });
    } catch (error: any) {
      console.error("Complete Activation Error:", error);

      return res.status(400).json({
        success: false,
        message:
          error?.message ||
          "Failed to complete membership activation.",
      });
    }
  }
}

export const membershipActivationController =
  new MembershipActivationController();