const isProduction = process.env.NODE_ENV === "production";
const cookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction
        ? "none"
        : "lax",
    path: "/",
};
export function setAuthCookies(res, accessToken, refreshToken) {
    res.cookie("accessToken", accessToken, {
        ...cookieOptions,
        maxAge: 15 * 60 * 1000,
    });
    res.cookie("refreshToken", refreshToken, {
        ...cookieOptions,
        maxAge: 30 *
            24 *
            60 *
            60 *
            1000,
    });
}
export function clearAuthCookies(res) {
    res.clearCookie("accessToken", cookieOptions);
    res.clearCookie("refreshToken", cookieOptions);
}
//# sourceMappingURL=auth-cookies.js.map