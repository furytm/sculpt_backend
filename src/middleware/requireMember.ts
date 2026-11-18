import { Request, Response, NextFunction } from "express";
import { UserRole } from "@prisma/client";

/** Member self-service routes: MEMBER accounts only. */
export default function requireMember(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized.",
    });
  }

  if (req.user.role !== UserRole.MEMBER) {
    return res.status(403).json({
      success: false,
      code: "MEMBER_ONLY",
      message: "Only member accounts can change their email here.",
    });
  }

  next();
}
