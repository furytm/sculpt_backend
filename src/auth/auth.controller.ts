import { Request, Response } from "express";
import { randomBytes } from "crypto";
import authService from "./auth.service.js";

import {
  registerSchema,
  loginSchema,
} from "./auth.validation.js";

import {
  setAuthCookies,
  clearAuthCookies,
} from "../utils/auth-cookies.js";

class AuthController {
  /**
   * POST /api/auth/register
   */
  async register(
    req: Request,
    res: Response
  ) {
    try {
      const {
        error,
        value,
      } = registerSchema.validate(req.body);

      if (error) {
        return res.status(400).json({
          success: false,
          message:
            error.details[0].message,
        });
      }

      const result =
        await authService.register(value);

      // Store access and refresh tokens
      // in HttpOnly cookies.
      setAuthCookies(
        res,
        result.accessToken,
        result.refreshToken
      );

      return res.status(201).json({
        success: true,
        message:
          "Account created successfully.",
        data: {
          user: result.user,
        },
      });
    } catch (error: any) {
      console.error(
        "Register Error:",
        error
      );

      return res.status(400).json({
        success: false,
        message:
          error.message ||
          "Registration failed.",
      });
    }
  }

  /**
   * POST /api/auth/login
   */
  async login(
    req: Request,
    res: Response
  ) {
    try {
      const {
        error,
        value,
      } = loginSchema.validate(req.body);

      if (error) {
        return res.status(400).json({
          success: false,
          message:
            error.details[0].message,
        });
      }

      const result =
        await authService.login(value);

      // Store access and refresh tokens
      // in HttpOnly cookies.
      setAuthCookies(
        res,
        result.accessToken,
        result.refreshToken
      );

      return res.status(200).json({
        success: true,
        message:
          "Login successful.",
        data: {
          user: result.user,
        },
      });
    } catch (error: any) {
      console.error(
        "Login Error:",
        error
      );

      return res.status(400).json({
        success: false,
        message:
          error.message ||
          "Login failed.",
      });
    }
  }

  /**
   * POST /api/auth/refresh
   */
  async refreshToken(
    req: Request,
    res: Response
  ) {
    try {
      // Read refresh token from HttpOnly cookie
      const refreshToken =
        req.cookies?.refreshToken;

      if (!refreshToken) {
        clearAuthCookies(res);

        return res.status(401).json({
          success: false,
          message:
            "Refresh token is required.",
        });
      }

      const tokens =
        await authService.refreshToken(
          refreshToken
        );

      // Replace old cookies with
      // the newly rotated tokens.
      setAuthCookies(
        res,
        tokens.accessToken,
        tokens.refreshToken
      );

      return res.status(200).json({
        success: true,
        message:
          "Token refreshed successfully.",
      });
    } catch (error: any) {
      console.error(
        "Refresh Token Error:",
        error
      );

      clearAuthCookies(res);

      return res.status(401).json({
        success: false,
        message:
          error.message ||
          "Invalid or expired refresh token.",
      });
    }
  }

  /**
   * POST /api/auth/logout
   */
  async logout(
    req: Request,
    res: Response
  ) {
    try {
      // Read refresh token from cookie
      const refreshToken =
        req.cookies?.refreshToken;

      // Remove refresh token from database
      if (refreshToken) {
        await authService.logout(
          refreshToken
        );
      }

      // Remove authentication cookies
      clearAuthCookies(res);

      return res.status(200).json({
        success: true,
        message:
          "Logged out successfully.",
      });
    } catch (error: any) {
      console.error(
        "Logout Error:",
        error
      );

      // Always clear cookies even if
      // database deletion fails.
      clearAuthCookies(res);

      return res.status(200).json({
        success: true,
        message:
          "Logged out successfully.",
      });
    }
  }

  /**
   * GET /api/auth/me
   */
  async me(
    req: Request,
    res: Response
  ) {
    try {
      const user =
        await authService.getCurrentUser(
          (req as any).user.userId
        );

      return res.status(200).json({
        success: true,
        data: user,
      });
    } catch (error: any) {
      return res.status(401).json({
        success: false,
        message:
          error.message ||
          "Unable to get current user.",
      });
    }
  }

  async updateProfile(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    const user = await authService.updateProfile(
      req.user.userId,
      req.body
    );

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully.",
      data: {
        user,
      },
    });
  } catch (error: any) {
    console.error("Update Profile Error:", error);

    return res.status(400).json({
      success: false,
      message: error.message || "Failed to update profile.",
    });
  }
}
  /**
   * GET /api/auth/google
   */
async google(req: Request, res: Response) {
  try {
    const reference =
      typeof req.query.reference === "string"
        ? req.query.reference.trim()
        : "";

    // Create unpredictable OAuth state to protect the callback.
    const nonce = randomBytes(32).toString("hex");

    const statePayload = {
      nonce,
      reference,
    };

    const state = Buffer.from(
      JSON.stringify(statePayload)
    ).toString("base64url");

    res.cookie("google_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 10 * 60 * 1000,
      path: "/api/auth/google/callback",
    });

    const url = await authService.getGoogleAuthUrl(state);

    return res.redirect(url);
  } catch (error: any) {
    console.error("Google Auth Error:", error);

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        "Unable to start Google authentication.",
    });
  }
}

  /**
   * GET /api/auth/google/callback
   */

async googleCallback(req: Request, res: Response) {
  const frontendUrl = process.env.FRONTEND_URL;

  const storedState = req.cookies?.google_oauth_state;
  const returnedState =
    typeof req.query.state === "string"
      ? req.query.state
      : "";

  res.clearCookie("google_oauth_state", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/google/callback",
  });

  try {
    if (!frontendUrl) {
      throw new Error("FRONTEND_URL is not configured.");
    }

    if (
      !storedState ||
      !returnedState ||
      storedState !== returnedState
    ) {
      return res.redirect(
        `${frontendUrl}/login?error=GOOGLE_AUTH_FAILED`
      );
    }

    let statePayload: {
      nonce: string;
      reference?: string;
    };

    try {
      statePayload = JSON.parse(
        Buffer.from(returnedState, "base64url").toString("utf8")
      );
    } catch {
      return res.redirect(
        `${frontendUrl}/login?error=GOOGLE_AUTH_FAILED`
      );
    }

    if (!statePayload.nonce) {
      return res.redirect(
        `${frontendUrl}/login?error=GOOGLE_AUTH_FAILED`
      );
    }

    const code =
      typeof req.query.code === "string"
        ? req.query.code
        : "";

    if (!code) {
      return res.redirect(
        `${frontendUrl}/login?error=GOOGLE_AUTH_FAILED`
      );
    }

    const result = await authService.googleCallback(code);

    setAuthCookies(
      res,
      result.accessToken,
      result.refreshToken
    );

    const reference =
      typeof statePayload.reference === "string"
        ? statePayload.reference.trim()
        : "";

    if (reference) {
      return res.redirect(
        `${frontendUrl}/auth/google-success?reference=${encodeURIComponent(reference)}`
      );
    }

    return res.redirect(`${frontendUrl}/dashboard`);
  } catch (error: any) {
    console.error("Google Callback Error:", error);

    if (error.message === "LOCAL_ACCOUNT_EXISTS") {
      return res.redirect(
        `${frontendUrl || ""}/login?error=LOCAL_ACCOUNT_EXISTS`
      );
    }

    return res.redirect(
      `${frontendUrl || ""}/login?error=GOOGLE_AUTH_FAILED`
    );
  }
}

  /**
   * GET /api/auth/verify-email?token=...
   */
  async verifyEmail(
    req: Request,
    res: Response
  ) {
    try {
      const token =
        req.query.token as string;

      if (!token) {
        return res.status(400).json({
          success: false,
          message:
            "Verification token is required.",
        });
      }

      const result =
        await authService.verifyEmail(
          token
        );

      return res.status(200).json(
        result
      );
    } catch (error: any) {
      return res.status(400).json({
        success: false,
        message:
          error.message ||
          "Email verification failed.",
      });
    }
  }

  /**
   * POST /api/auth/forgot-password
   */
  async forgotPassword(
    req: Request,
    res: Response
  ) {
    try {
      const { email } =
        req.body;

      if (!email) {
        return res.status(400).json({
          success: false,
          message:
            "Email is required.",
        });
      }

      const result =
        await authService.forgotPassword(
          email
        );

      return res.status(200).json(
        result
      );
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message:
          error.message ||
          "Unable to process password reset request.",
      });
    }
  }

  /**
   * POST /api/auth/reset-password
   */
  async resetPassword(
    req: Request,
    res: Response
  ) {
    try {
      const {
        token,
        password,
        confirmPassword,
      } = req.body;

      const result =
        await authService.resetPassword(
          token,
          password,
          confirmPassword
        );

      return res.status(200).json(
        result
      );
    } catch (error: any) {
      return res.status(400).json({
        success: false,
        message:
          error.message ||
          "Unable to reset password.",
      });
    }
  }
}

export default new AuthController();