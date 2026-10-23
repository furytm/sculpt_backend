
import { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../utils/jwt.js";

export default function optionalAuthenticate(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const token =
    req.cookies?.accessToken ||
    req.headers.authorization?.replace(/^Bearer\s+/, "");

  if (!token) {
    return next();
  }

  try {
    req.user = verifyAccessToken(token);
    return next();
  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token.",
    });
  }
}
