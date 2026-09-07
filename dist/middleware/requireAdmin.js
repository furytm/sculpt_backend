import { UserRole } from "@prisma/client";
export default function requireAdmin(req, res, next) {
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
//# sourceMappingURL=requireAdmin.js.map