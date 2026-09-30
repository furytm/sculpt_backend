import jwt from "jsonwebtoken";
function getAccessSecret() {
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret) {
        throw new Error("JWT_ACCESS_SECRET is not configured.");
    }
    return secret;
}
function getRefreshSecret() {
    const secret = process.env.JWT_REFRESH_SECRET;
    if (!secret) {
        throw new Error("JWT_REFRESH_SECRET is not configured.");
    }
    return secret;
}
export function generateAccessToken(payload) {
    return jwt.sign(payload, getAccessSecret(), {
        expiresIn: "15m",
    });
}
export function generateRefreshToken(payload) {
    return jwt.sign(payload, getRefreshSecret(), {
        expiresIn: "30d",
    });
}
export function verifyAccessToken(token) {
    return jwt.verify(token, getAccessSecret());
}
export function verifyRefreshToken(token) {
    return jwt.verify(token, getRefreshSecret());
}
//# sourceMappingURL=jwt.js.map