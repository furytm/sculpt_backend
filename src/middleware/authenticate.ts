import { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../utils/jwt.js";



export default function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    // Prefer the HttpOnly cookie
    // Keep Authorization header as a fallback
    const token =
      req.cookies?.accessToken ||
      req.headers.authorization?.replace(
        "Bearer ",
        ""
      );

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    const payload =
      verifyAccessToken(token);

    (req as any).user = payload;

    next();
  } catch {
    return res.status(401).json({
      success: false,
      message:
        "Invalid or expired token.",
    });
  }
}

