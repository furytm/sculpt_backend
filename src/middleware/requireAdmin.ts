import { Request, Response, NextFunction } from "express";
import { UserRole } from "@prisma/client";

export default function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized.",
    });
  }

  if (req.user.role !== UserRole.ADMIN) {
    return res.status(403).json({
      success: false,
      message: "Admin access required.",
    });
  }

  next();
}