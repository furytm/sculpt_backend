/**
 * Member self-service email change, in two verified stages:
 *
 *   1. request:        password check, then a code to the CURRENT email.
 *   2. verify-current: that code proves the member still owns the account;
 *                      a second code goes to the NEW email.
 *   3. verify-new:     that code proves the member owns the new email;
 *                      only now does User.email change (in one transaction
 *                      that re-checks uniqueness, revokes every refresh
 *                      token and issues a new session).
 *
 * Until step 3 the new address exists only in EmailChangeRequest, so
 * login, Google sign-in and every email-based booking or purchase match
 * keep using the verified current address.
 *
 * Codes: 6 random digits; only an HMAC (keyed with a server secret and
 * bound to the member, the new email and the stage) is stored; 10-minute
 * expiry; single use; at most 5 checks and 5 sends per stage; 60 seconds
 * between sends; the whole request lapses after 30 minutes.
 */
import crypto from "crypto";
import { AuthProvider, EmailChangeStage, UserRole } from "@prisma/client";
import prisma from "../config/prisma.js";
import { comparePassword } from "../utils/bcrypt.js";
import { generateNumericCode } from "../utils/auth-token.js";
import { generateAccessToken, generateRefreshToken } from "../utils/jwt.js";
import { sendEmailChangeCodeEmail, sendEmailChangedNoticeEmail } from "../utils/mailer.js";
const MINUTE = 60 * 1000;
export const EMAIL_CHANGE_LIMITS = {
    codeTtlMs: 10 * MINUTE,
    requestTtlMs: 30 * MINUTE,
    maxAttemptsPerStage: 5,
    maxSendsPerStage: 5,
    resendCooldownMs: 1 * MINUTE,
};
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * MINUTE; // matches login
/** An expected failure, returned to the client as { success: false, code, message, data? }. */
export class EmailChangeError extends Error {
    status;
    code;
    details;
    constructor(status, code, message, details) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
        this.name = "EmailChangeError";
    }
}
const UNAVAILABLE_MESSAGE = "This email address can't be used. Please choose a different one.";
// ---------------------------------------------------------------- codes
function codeKey() {
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret)
        throw new Error("JWT_ACCESS_SECRET is not configured.");
    // A key of its own, derived from the server secret, so a code hash
    // can't be confused with any other use of that secret.
    return crypto.createHmac("sha256", secret).update("sculptlab:email-change-code:v1").digest();
}
function hashCode(request, stage, code) {
    return crypto
        .createHmac("sha256", codeKey())
        .update(`${request.userId}\n${request.newEmail}\n${stage}\n${code}`)
        .digest("hex");
}
function codeMatches(request, code) {
    if (!request.codeHash)
        return false;
    const expected = Buffer.from(request.codeHash, "hex");
    const actual = Buffer.from(hashCode(request, request.stage, code), "hex");
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
// -------------------------------------------------------------- helpers
const normalize = (email) => email.trim().toLowerCase();
/** What the client may see about a pending request. */
export function describeRequest(request, now = new Date()) {
    const resendAt = request.lastSentAt
        ? new Date(request.lastSentAt.getTime() + EMAIL_CHANGE_LIMITS.resendCooldownMs)
        : now;
    return {
        stage: request.stage,
        newEmail: request.newEmail,
        sentTo: request.stage === EmailChangeStage.VERIFY_CURRENT ? request.currentEmail : request.newEmail,
        codeExpiresAt: request.codeExpiresAt,
        expiresAt: request.expiresAt,
        resendAvailableAt: resendAt > now ? resendAt : now,
        attemptsRemaining: Math.max(0, EMAIL_CHANGE_LIMITS.maxAttemptsPerStage - request.attempts),
        sendsRemaining: Math.max(0, EMAIL_CHANGE_LIMITS.maxSendsPerStage - request.sendCount),
    };
}
async function loadMember(userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
        throw new EmailChangeError(404, "USER_NOT_FOUND", "User not found.");
    }
    if (user.role !== UserRole.MEMBER) {
        throw new EmailChangeError(403, "MEMBER_ONLY", "Only member accounts can change their email here.");
    }
    // Google accounts are found by their Google email at sign-in. Changing
    // it here would make the next Google sign-in create a second account,
    // so the email of a Google account stays managed by Google.
    if (user.provider === AuthProvider.GOOGLE) {
        throw new EmailChangeError(400, "GOOGLE_ACCOUNT", "Your account signs in with Google, so its email address is managed by Google and can't be changed here. Please contact Sculpt LAB if you need help.");
    }
    return user;
}
async function isEmailTaken(email, exceptUserId, client = prisma) {
    const existing = await client.user.findFirst({
        where: {
            email: { equals: email, mode: "insensitive" },
            NOT: { id: exceptUserId },
        },
        select: { id: true },
    });
    return Boolean(existing);
}
async function deleteRequest(id) {
    await prisma.emailChangeRequest.deleteMany({ where: { id } });
}
/** The member's pending request, or an error when there is none usable. */
async function activeRequest(user, now = new Date()) {
    const request = await prisma.emailChangeRequest.findUnique({ where: { userId: user.id } });
    if (!request) {
        throw new EmailChangeError(404, "NO_PENDING_REQUEST", "There is no pending email change. Please start again.");
    }
    if (request.expiresAt.getTime() <= now.getTime()) {
        await deleteRequest(request.id);
        throw new EmailChangeError(410, "REQUEST_EXPIRED", "This email change request has expired. Please start again.");
    }
    // The account email changed some other way since this request began.
    if (normalize(user.email) !== normalize(request.currentEmail)) {
        await deleteRequest(request.id);
        throw new EmailChangeError(409, "REQUEST_INVALIDATED", "Your account email has changed since this request began. Please start again.");
    }
    return request;
}
function assertStage(request, stage) {
    if (request.stage !== stage) {
        throw new EmailChangeError(409, "WRONG_STAGE", stage === EmailChangeStage.VERIFY_CURRENT
            ? "Your current email is already verified. Enter the code sent to your new email."
            : "Please verify your current email address first.", { stage: request.stage });
    }
}
/**
 * Checks a code for the request's current stage. An attempt is claimed
 * atomically BEFORE the comparison, so parallel guesses can never get
 * more than maxAttemptsPerStage checks.
 */
async function checkCode(request, code, now = new Date()) {
    if (!request.codeHash || !request.codeExpiresAt) {
        throw new EmailChangeError(409, "CODE_NO_LONGER_VALID", "This code is no longer valid. Please request a new code.");
    }
    if (request.codeExpiresAt.getTime() <= now.getTime()) {
        throw new EmailChangeError(400, "CODE_EXPIRED", "This code has expired. Please request a new code.", {
            ...describeRequest(request, now),
        });
    }
    const claimed = await prisma.emailChangeRequest.updateMany({
        where: {
            id: request.id,
            stage: request.stage,
            codeHash: request.codeHash,
            attempts: { lt: EMAIL_CHANGE_LIMITS.maxAttemptsPerStage },
        },
        data: { attempts: { increment: 1 } },
    });
    const current = await prisma.emailChangeRequest.findUnique({ where: { id: request.id } });
    if (claimed.count !== 1) {
        if (current && current.attempts >= EMAIL_CHANGE_LIMITS.maxAttemptsPerStage) {
            await deleteRequest(request.id);
            throw new EmailChangeError(429, "TOO_MANY_ATTEMPTS", "Too many incorrect codes. This email change has been cancelled. Please start again.");
        }
        // Used, replaced by a newer code, or cancelled meanwhile.
        throw new EmailChangeError(409, "CODE_NO_LONGER_VALID", "This code is no longer valid. Please use the most recent code we sent.");
    }
    if (codeMatches(request, code))
        return;
    const attempts = current?.attempts ?? EMAIL_CHANGE_LIMITS.maxAttemptsPerStage;
    if (attempts >= EMAIL_CHANGE_LIMITS.maxAttemptsPerStage) {
        await deleteRequest(request.id);
        throw new EmailChangeError(429, "TOO_MANY_ATTEMPTS", "Too many incorrect codes. This email change has been cancelled. Please start again.");
    }
    throw new EmailChangeError(400, "INVALID_CODE", "That code is incorrect.", {
        attemptsRemaining: EMAIL_CHANGE_LIMITS.maxAttemptsPerStage - attempts,
    });
}
function sendCode(request, fullName, code) {
    const toCurrent = request.stage === EmailChangeStage.VERIFY_CURRENT;
    return sendEmailChangeCodeEmail({
        to: toCurrent ? request.currentEmail : request.newEmail,
        fullName,
        code,
        purpose: toCurrent ? "current" : "new",
        newEmail: request.newEmail,
        expiresInMinutes: EMAIL_CHANGE_LIMITS.codeTtlMs / MINUTE,
    });
}
function retryAfterSeconds(request, now) {
    if (!request.lastSentAt)
        return 0;
    const wait = request.lastSentAt.getTime() + EMAIL_CHANGE_LIMITS.resendCooldownMs - now.getTime();
    return wait > 0 ? Math.ceil(wait / 1000) : 0;
}
// ------------------------------------------------------------- service
class EmailChangeService {
    /** Stage 1: check the password and new email, then email a code to the CURRENT address. */
    async request(userId, input) {
        const now = new Date();
        const user = await loadMember(userId);
        if (!user.password) {
            throw new EmailChangeError(400, "PASSWORD_NOT_SET", "Please set a password for your account before changing your email address.");
        }
        if (!input.currentPassword) {
            throw new EmailChangeError(400, "VALIDATION_ERROR", "Your current password is required.");
        }
        if (!(await comparePassword(input.currentPassword, user.password))) {
            throw new EmailChangeError(400, "INVALID_PASSWORD", "Your current password is incorrect.");
        }
        const newEmail = normalize(input.newEmail);
        if (newEmail === normalize(user.email)) {
            throw new EmailChangeError(400, "EMAIL_UNCHANGED", "This is already your account email address.");
        }
        if (await isEmailTaken(newEmail, user.id)) {
            throw new EmailChangeError(409, "EMAIL_UNAVAILABLE", UNAVAILABLE_MESSAGE);
        }
        // Starting again replaces a pending request, but not more often than
        // a code could be resent.
        const existing = await prisma.emailChangeRequest.findUnique({ where: { userId: user.id } });
        if (existing && existing.expiresAt > now) {
            const wait = retryAfterSeconds(existing, now);
            if (wait > 0) {
                throw new EmailChangeError(429, "RESEND_TOO_SOON", `Please wait ${wait} seconds before requesting another code.`, { retryAfterSeconds: wait });
            }
        }
        const code = generateNumericCode();
        const draft = { userId: user.id, newEmail };
        const request = await prisma.$transaction(async (tx) => {
            // One request per member: concurrent starts for the same member queue here.
            await tx.$queryRaw `SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
            await tx.emailChangeRequest.deleteMany({ where: { userId: user.id } });
            return tx.emailChangeRequest.create({
                data: {
                    userId: user.id,
                    currentEmail: user.email,
                    newEmail,
                    stage: EmailChangeStage.VERIFY_CURRENT,
                    codeHash: hashCode(draft, EmailChangeStage.VERIFY_CURRENT, code),
                    codeExpiresAt: new Date(now.getTime() + EMAIL_CHANGE_LIMITS.codeTtlMs),
                    attempts: 0,
                    sendCount: 1,
                    lastSentAt: now,
                    expiresAt: new Date(now.getTime() + EMAIL_CHANGE_LIMITS.requestTtlMs),
                },
            });
        });
        try {
            await sendCode(request, user.fullName, code);
        }
        catch (error) {
            console.error("Email change: could not send the current-email code:", error);
            await deleteRequest(request.id);
            throw new EmailChangeError(502, "EMAIL_SEND_FAILED", "We couldn't send a verification code to your current email address. Please try again.");
        }
        return describeRequest(request, now);
    }
    /** Stage 2: the code from the CURRENT address; then a code goes to the NEW address. */
    async verifyCurrent(userId, code) {
        const now = new Date();
        const user = await loadMember(userId);
        const request = await activeRequest(user, now);
        assertStage(request, EmailChangeStage.VERIFY_CURRENT);
        await checkCode(request, code, now);
        if (await isEmailTaken(request.newEmail, user.id)) {
            await deleteRequest(request.id);
            throw new EmailChangeError(409, "EMAIL_UNAVAILABLE", UNAVAILABLE_MESSAGE);
        }
        const newCode = generateNumericCode();
        // Single use: only the request still holding this exact code advances.
        const advanced = await prisma.emailChangeRequest.updateMany({
            where: {
                id: request.id,
                stage: EmailChangeStage.VERIFY_CURRENT,
                codeHash: request.codeHash,
            },
            data: {
                stage: EmailChangeStage.VERIFY_NEW,
                codeHash: hashCode(request, EmailChangeStage.VERIFY_NEW, newCode),
                codeExpiresAt: new Date(now.getTime() + EMAIL_CHANGE_LIMITS.codeTtlMs),
                attempts: 0,
                sendCount: 1,
                lastSentAt: now,
                currentVerifiedAt: now,
            },
        });
        if (advanced.count !== 1) {
            throw new EmailChangeError(409, "CODE_NO_LONGER_VALID", "This code has already been used.");
        }
        const updated = (await prisma.emailChangeRequest.findUnique({ where: { id: request.id } }));
        try {
            await sendCode(updated, user.fullName, newCode);
        }
        catch (error) {
            console.error("Email change: could not send the new-email code:", error);
            // Let the member resend straight away (the send still counts).
            await prisma.emailChangeRequest.updateMany({
                where: { id: request.id, stage: EmailChangeStage.VERIFY_NEW },
                data: { lastSentAt: null },
            });
            throw new EmailChangeError(502, "EMAIL_SEND_FAILED", "Your current email is verified, but we couldn't send a code to your new email address. Please use resend to try again.", { stage: EmailChangeStage.VERIFY_NEW });
        }
        return describeRequest(updated, now);
    }
    /** Stage 3: the code from the NEW address; the email changes and a new session starts. */
    async verifyNew(userId, code) {
        const now = new Date();
        const user = await loadMember(userId);
        const request = await activeRequest(user, now);
        assertStage(request, EmailChangeStage.VERIFY_NEW);
        await checkCode(request, code, now);
        let outcome;
        try {
            outcome = await prisma.$transaction(async (tx) => {
                await tx.$queryRaw `SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
                // Single use: consume the request holding this exact code.
                const consumed = await tx.emailChangeRequest.deleteMany({
                    where: {
                        id: request.id,
                        stage: EmailChangeStage.VERIFY_NEW,
                        codeHash: request.codeHash,
                    },
                });
                if (consumed.count !== 1) {
                    throw new EmailChangeError(409, "CODE_NO_LONGER_VALID", "This code has already been used.");
                }
                const fresh = await tx.user.findUnique({ where: { id: user.id } });
                if (!fresh || normalize(fresh.email) !== normalize(request.currentEmail)) {
                    // Commit the deletion: this request can never succeed.
                    return {
                        ok: false,
                        error: new EmailChangeError(409, "REQUEST_INVALIDATED", "Your account email has changed since this request began. Please start again."),
                    };
                }
                if (await isEmailTaken(request.newEmail, user.id, tx)) {
                    return { ok: false, error: new EmailChangeError(409, "EMAIL_UNAVAILABLE", UNAVAILABLE_MESSAGE) };
                }
                // The unique index on User.email is the final arbiter if another
                // account takes this address at the same moment (P2002 below).
                const changed = await tx.user.update({
                    where: { id: user.id },
                    data: { email: request.newEmail, isEmailVerified: true },
                });
                // Sign out every other session, then start this one afresh.
                await tx.refreshToken.deleteMany({ where: { userId: user.id } });
                const payload = { userId: changed.id, email: changed.email, role: changed.role };
                const accessToken = generateAccessToken(payload);
                const refreshToken = generateRefreshToken(payload);
                await tx.refreshToken.create({
                    data: {
                        token: refreshToken,
                        userId: changed.id,
                        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
                    },
                });
                return { ok: true, user: changed, accessToken, refreshToken };
            });
        }
        catch (error) {
            if (error instanceof EmailChangeError)
                throw error;
            // Another account took the address at the same moment.
            const unique = error;
            if (unique?.code === "P2002" && String(unique.meta?.target ?? "").includes("email")) {
                await deleteRequest(request.id);
                throw new EmailChangeError(409, "EMAIL_UNAVAILABLE", UNAVAILABLE_MESSAGE);
            }
            throw error;
        }
        if (!outcome.ok)
            throw outcome.error;
        try {
            await sendEmailChangedNoticeEmail({
                to: request.currentEmail,
                fullName: outcome.user.fullName,
                newEmail: outcome.user.email,
            });
        }
        catch (error) {
            // The change is done; a failed notice must not undo it.
            console.error("Email change: could not notify the previous email address:", error);
        }
        const changed = outcome.user;
        return {
            user: {
                id: changed.id,
                fullName: changed.fullName,
                email: changed.email,
                phone: changed.phone,
                provider: changed.provider,
                role: changed.role,
                isEmailVerified: changed.isEmailVerified,
                avatar: changed.avatar,
            },
            accessToken: outcome.accessToken,
            refreshToken: outcome.refreshToken,
        };
    }
    /** A fresh code for the current stage; the previous code stops working. */
    async resend(userId) {
        const now = new Date();
        const user = await loadMember(userId);
        const request = await activeRequest(user, now);
        const wait = retryAfterSeconds(request, now);
        if (wait > 0) {
            throw new EmailChangeError(429, "RESEND_TOO_SOON", `Please wait ${wait} seconds before requesting another code.`, { retryAfterSeconds: wait });
        }
        if (request.sendCount >= EMAIL_CHANGE_LIMITS.maxSendsPerStage) {
            throw new EmailChangeError(429, "RESEND_LIMIT_REACHED", "You've requested the maximum number of codes. Please cancel and start again.");
        }
        if (request.attempts >= EMAIL_CHANGE_LIMITS.maxAttemptsPerStage) {
            await deleteRequest(request.id);
            throw new EmailChangeError(429, "TOO_MANY_ATTEMPTS", "Too many incorrect codes. This email change has been cancelled. Please start again.");
        }
        const code = generateNumericCode();
        // Only one of several simultaneous resends wins.
        const replaced = await prisma.emailChangeRequest.updateMany({
            where: { id: request.id, stage: request.stage, sendCount: request.sendCount },
            data: {
                codeHash: hashCode(request, request.stage, code),
                codeExpiresAt: new Date(now.getTime() + EMAIL_CHANGE_LIMITS.codeTtlMs),
                sendCount: { increment: 1 },
                lastSentAt: now,
            },
        });
        if (replaced.count !== 1) {
            throw new EmailChangeError(429, "RESEND_TOO_SOON", "A new code was just sent. Please check your inbox.", { retryAfterSeconds: EMAIL_CHANGE_LIMITS.resendCooldownMs / 1000 });
        }
        const updated = (await prisma.emailChangeRequest.findUnique({ where: { id: request.id } }));
        try {
            await sendCode(updated, user.fullName, code);
        }
        catch (error) {
            console.error("Email change: could not resend the code:", error);
            await prisma.emailChangeRequest.updateMany({
                where: { id: request.id, sendCount: updated.sendCount },
                data: { lastSentAt: null },
            });
            throw new EmailChangeError(502, "EMAIL_SEND_FAILED", "We couldn't send the code. Please try again.");
        }
        return describeRequest(updated, now);
    }
    /** Cancels the member's pending request, if any. */
    async cancel(userId) {
        const { count } = await prisma.emailChangeRequest.deleteMany({ where: { userId } });
        return { cancelled: count > 0 };
    }
}
export default new EmailChangeService();
//# sourceMappingURL=email-change.service.js.map