
import { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../utils/jwt.js";
import { rejectTutorOutsideAllowedRoutes } from "./tutorAccess.js";

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

  let payload;

  try {
    payload = verifyAccessToken(token);
  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token.",
    });
  }

  req.user = payload;

  // Tutors may only use their allow-listed routes (for example, a
  // signed-in tutor can't make a membership purchase).
  if (rejectTutorOutsideAllowedRoutes(req, res)) {
    return;
  }

  return next();
}
