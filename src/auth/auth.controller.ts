import { Request, Response } from "express";
import authService from "./auth.service.js";
import { registerSchema, loginSchema } from "./auth.validation.js";

class AuthController {
  /**
   * POST /api/auth/register
   */
  async register(req: Request, res: Response) {
    try {
      const { error, value } = registerSchema.validate(req.body);

      if (error) {
        return res.status(400).json({
          success: false,
          message: error.details[0].message,
        });
      }

      const result = await authService.register(value);

      return res.status(201).json({
        success: true,
        message: "Account created successfully.",
        data: result,
      });
    } catch (error: any) {
      console.error("Register Error:", error);

      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  /**
   * POST /api/auth/login
   */
  async login(req: Request, res: Response) {
    try {
      const { error, value } = loginSchema.validate(req.body);

      if (error) {
        return res.status(400).json({
          success: false,
          message: error.details[0].message,
        });
      }

      const result = await authService.login(value);

      return res.status(200).json({
        success: true,
        message: "Login successful.",
        data: result,
      });
    } catch (error: any) {
      console.error("Login Error:", error);

      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  /**
   * POST /api/auth/refresh
   */
  async refreshToken(req: Request, res: Response) {
    try {
      const { refreshToken } = req.body;

      const tokens = await authService.refreshToken(refreshToken);

      return res.status(200).json({
        success: true,
        data: tokens,
      });
    } catch (error: any) {
      return res.status(401).json({
        success: false,
        message: error.message,
      });
    }
  }

  /**
   * POST /api/auth/logout
   */
  async logout(req: Request, res: Response) {
    try {
      const { refreshToken } = req.body;

      await authService.logout(refreshToken);

      return res.status(200).json({
        success: true,
        message: "Logged out successfully.",
      });
    } catch (error: any) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  /**
   * GET /api/auth/me
   */
  async me(req: Request, res: Response) {
    try {
      const user = await authService.getCurrentUser(
        (req as any).user.userId
      );

      return res.status(200).json({
        success: true,
        data: user,
      });
    } catch (error: any) {
      return res.status(401).json({
        success: false,
        message: error.message,
      });
    }
  }





  /**
   * GET /api/auth/google
   */
  async google(
    req: Request,
    res: Response
  ) {
    try {
      const url =
        await authService.getGoogleAuthUrl();

      return res.redirect(url);
    } catch (error: any) {
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
  async googleCallback(
    req: Request,
    res: Response
  ) {
    try {
      const code =
        req.query.code as string;

      const result =
        await authService.googleCallback(
          code
        );

      /*
       * We will eventually replace this
       * with a secure frontend callback strategy.
       */
      const redirectUrl =
        new URL(
          `${process.env.FRONTEND_URL}/auth/google/callback`
        );

      redirectUrl.searchParams.set(
        "accessToken",
        result.accessToken
      );

      redirectUrl.searchParams.set(
        "refreshToken",
        result.refreshToken
      );

      return res.redirect(
        redirectUrl.toString()
      );
    } catch (error: any) {

      if (
        error.message ===
        "LOCAL_ACCOUNT_EXISTS"
      ) {
        return res.redirect(
          `${process.env.FRONTEND_URL}/login?error=LOCAL_ACCOUNT_EXISTS`
        );
      }

      return res.redirect(
        `${process.env.FRONTEND_URL}/login?error=GOOGLE_AUTH_FAILED`
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
    const token = req.query.token as string;

    const result = await authService.verifyEmail(token);

    return res.status(200).json(result);
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
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required.",
      });
    }

    const result =
      await authService.forgotPassword(email);

    return res.status(200).json(result);
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

    return res.status(200).json(result);
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