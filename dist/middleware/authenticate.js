import { verifyAccessToken } from "../utils/jwt.js";
export default function authenticate(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized.",
            });
        }
        const token = authHeader.split(" ")[1];
        const payload = verifyAccessToken(token);
        req.user = payload;
        next();
    }
    catch {
        return res.status(401).json({
            success: false,
            message: "Invalid or expired token.",
        });
    }
}
//# sourceMappingURL=authenticate.js.map