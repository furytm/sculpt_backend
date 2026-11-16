import { Request, Response, NextFunction } from "express";
import { UserRole } from "@prisma/client";

/**
 * Allow only the given roles. For routes shared by more than one role;
 * admin-only routes keep using requireAdmin.
 */
export default function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Admin access required.",
      });
    }

    next();
  };
}
