import { UserRole } from "@prisma/client";
/** Member self-service routes (email change, Health & Safety): MEMBER accounts only. */
export default function requireMember(req, res, next) {
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
            message: "This is only available to member accounts.",
        });
    }
    next();
}
//# sourceMappingURL=requireMember.js.map