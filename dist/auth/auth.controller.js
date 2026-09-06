import authService from "./auth.service.js";
import { registerSchema, loginSchema, } from "./auth.validation.js";
import { setAuthCookies, clearAuthCookies, } from "../utils/auth-cookies.js";
class AuthController {
    /**
     * POST /api/auth/register
     */
    async register(req, res) {
        try {
            const { error, value, } = registerSchema.validate(req.body);
            if (error) {
                return res.status(400).json({
                    success: false,
                    message: error.details[0].message,
                });
            }
            const result = await authService.register(value);
            // Store access and refresh tokens
            // in HttpOnly cookies.
            setAuthCookies(res, result.accessToken, result.refreshToken);
            return res.status(201).json({
                success: true,
                message: "Account created successfully.",
                data: {
                    user: result.user,
                },
            });
        }
        catch (error) {
            console.error("Register Error:", error);
            return res.status(400).json({
                success: false,
                message: error.message ||
                    "Registration failed.",
            });
        }
    }
    /**
     * POST /api/auth/login
     */
    async login(req, res) {
        try {
            const { error, value, } = loginSchema.validate(req.body);
            if (error) {
                return res.status(400).json({
                    success: false,
                    message: error.details[0].message,
                });
            }
            const result = await authService.login(value);
            // Store access and refresh tokens
            // in HttpOnly cookies.
            setAuthCookies(res, result.accessToken, result.refreshToken);
            return res.status(200).json({
                success: true,
                message: "Login successful.",
                data: {
                    user: result.user,
                },
            });
        }
        catch (error) {
            console.error("Login Error:", error);
            return res.status(400).json({
                success: false,
                message: error.message ||
                    "Login failed.",
            });
        }
    }
    /**
     * POST /api/auth/refresh
     */
    async refreshToken(req, res) {
        try {
            // Read refresh token from HttpOnly cookie
            const refreshToken = req.cookies?.refreshToken;
            if (!refreshToken) {
                clearAuthCookies(res);
                return res.status(401).json({
                    success: false,
                    message: "Refresh token is required.",
                });
            }
            const tokens = await authService.refreshToken(refreshToken);
            // Replace old cookies with
            // the newly rotated tokens.
            setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
            return res.status(200).json({
                success: true,
                message: "Token refreshed successfully.",
            });
        }
        catch (error) {
            console.error("Refresh Token Error:", error);
            clearAuthCookies(res);
            return res.status(401).json({
                success: false,
                message: error.message ||
                    "Invalid or expired refresh token.",
            });
        }
    }
    /**
     * POST /api/auth/logout
     */
    async logout(req, res) {
        try {
            // Read refresh token from cookie
            const refreshToken = req.cookies?.refreshToken;
            // Remove refresh token from database
            if (refreshToken) {
                await authService.logout(refreshToken);
            }
            // Remove authentication cookies
            clearAuthCookies(res);
            return res.status(200).json({
                success: true,
                message: "Logged out successfully.",
            });
        }
        catch (error) {
            console.error("Logout Error:", error);
            // Always clear cookies even if
            // database deletion fails.
            clearAuthCookies(res);
            return res.status(200).json({
                success: true,
                message: "Logged out successfully.",
            });
        }
    }
    /**
     * GET /api/auth/me
     */
    async me(req, res) {
        try {
            const user = await authService.getCurrentUser(req.user.userId);
            return res.status(200).json({
                success: true,
                data: user,
            });
        }
        catch (error) {
            return res.status(401).json({
                success: false,
                message: error.message ||
                    "Unable to get current user.",
            });
        }
    }
    /**
     * GET /api/auth/google
     */
    async google(req, res) {
        try {
            const url = await authService.getGoogleAuthUrl();
            return res.redirect(url);
        }
        catch (error) {
            console.error("Google Auth Error:", error);
            return res.status(500).json({
                success: false,
                message: error.message ||
                    "Unable to start Google authentication.",
            });
        }
    }
    /**
     * GET /api/auth/google/callback
     */
    async googleCallback(req, res) {
        try {
            const code = req.query.code;
            if (!code) {
                return res.redirect(`${process.env.FRONTEND_URL}/login?error=GOOGLE_AUTH_FAILED`);
            }
            const result = await authService.googleCallback(code);
            // Store Google authentication tokens
            // in HttpOnly cookies.
            setAuthCookies(res, result.accessToken, result.refreshToken);
            // Do NOT put tokens in the URL.
            return res.redirect(`${process.env.FRONTEND_URL}/dashboard`);
        }
        catch (error) {
            console.error("Google Callback Error:", error);
            if (error.message ===
                "LOCAL_ACCOUNT_EXISTS") {
                return res.redirect(`${process.env.FRONTEND_URL}/login?error=LOCAL_ACCOUNT_EXISTS`);
            }
            return res.redirect(`${process.env.FRONTEND_URL}/login?error=GOOGLE_AUTH_FAILED`);
        }
    }
    /**
     * GET /api/auth/verify-email?token=...
     */
    async verifyEmail(req, res) {
        try {
            const token = req.query.token;
            if (!token) {
                return res.status(400).json({
                    success: false,
                    message: "Verification token is required.",
                });
            }
            const result = await authService.verifyEmail(token);
            return res.status(200).json(result);
        }
        catch (error) {
            return res.status(400).json({
                success: false,
                message: error.message ||
                    "Email verification failed.",
            });
        }
    }
    /**
     * POST /api/auth/forgot-password
     */
    async forgotPassword(req, res) {
        try {
            const { email } = req.body;
            if (!email) {
                return res.status(400).json({
                    success: false,
                    message: "Email is required.",
                });
            }
            const result = await authService.forgotPassword(email);
            return res.status(200).json(result);
        }
        catch (error) {
            return res.status(500).json({
                success: false,
                message: error.message ||
                    "Unable to process password reset request.",
            });
        }
    }
    /**
     * POST /api/auth/reset-password
     */
    async resetPassword(req, res) {
        try {
            const { token, password, confirmPassword, } = req.body;
            const result = await authService.resetPassword(token, password, confirmPassword);
            return res.status(200).json(result);
        }
        catch (error) {
            return res.status(400).json({
                success: false,
                message: error.message ||
                    "Unable to reset password.",
            });
        }
    }
}
export default new AuthController();
//# sourceMappingURL=auth.controller.js.map