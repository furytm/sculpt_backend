import { Request, Response } from "express";
import Joi from "joi";
import emailChangeService, { EmailChangeError } from "./email-change.service.js";
import { emailChangeCodeSchema, emailChangeRequestSchema } from "./auth.validation.js";
import { setAuthCookies } from "../utils/auth-cookies.js";

/** Every failure has the shape { success: false, code, message, data? }. */
function sendError(res: Response, error: unknown) {
  if (error instanceof EmailChangeError) {
    return res.status(error.status).json({
      success: false,
      code: error.code,
      message: error.message,
      ...(error.details && { data: error.details }),
    });
  }

  console.error("Email change error:", error);

  return res.status(500).json({
    success: false,
    code: "INTERNAL_ERROR",
    message: "Something went wrong. Please try again.",
  });
}

function validate<T>(schema: Joi.ObjectSchema<T>, body: unknown): T {
  const { error, value } = schema.validate(body ?? {}, { abortEarly: true });

  if (error) {
    throw new EmailChangeError(400, "VALIDATION_ERROR", error.details[0].message);
  }

  return value;
}

class EmailChangeController {
  /** POST /api/auth/email-change/request */
  async request(req: Request, res: Response) {
    try {
      const input = validate(emailChangeRequestSchema, req.body);
      const data = await emailChangeService.request(req.user!.userId, input);

      return res.status(200).json({
        success: true,
        message: `We've sent a 6-digit code to ${data.sentTo}. Enter it to confirm it's you.`,
        data,
      });
    } catch (error) {
      return sendError(res, error);
    }
  }

  /** POST /api/auth/email-change/verify-current */
  async verifyCurrent(req: Request, res: Response) {
    try {
      const { code } = validate(emailChangeCodeSchema, req.body);
      const data = await emailChangeService.verifyCurrent(req.user!.userId, code);

      return res.status(200).json({
        success: true,
        message: `Your current email is verified. We've sent a 6-digit code to ${data.sentTo}.`,
        data,
      });
    } catch (error) {
      return sendError(res, error);
    }
  }

  /** POST /api/auth/email-change/verify-new */
  async verifyNew(req: Request, res: Response) {
    try {
      const { code } = validate(emailChangeCodeSchema, req.body);
      const result = await emailChangeService.verifyNew(req.user!.userId, code);

      // Every previous session was revoked; this one continues with new cookies.
      setAuthCookies(res, result.accessToken, result.refreshToken);

      return res.status(200).json({
        success: true,
        message: "Your email address has been changed.",
        data: { user: result.user },
      });
    } catch (error) {
      return sendError(res, error);
    }
  }

  /** POST /api/auth/email-change/resend */
  async resend(req: Request, res: Response) {
    try {
      const data = await emailChangeService.resend(req.user!.userId);

      return res.status(200).json({
        success: true,
        message: `We've sent a new code to ${data.sentTo}.`,
        data,
      });
    } catch (error) {
      return sendError(res, error);
    }
  }

  /** DELETE /api/auth/email-change */
  async cancel(req: Request, res: Response) {
    try {
      const data = await emailChangeService.cancel(req.user!.userId);

      return res.status(200).json({
        success: true,
        message: data.cancelled
          ? "Your email change has been cancelled."
          : "There was no pending email change.",
        data,
      });
    } catch (error) {
      return sendError(res, error);
    }
  }
}

export default new EmailChangeController();
