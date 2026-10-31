import prisma from "../config/prisma.js";
import webpush from "web-push";
import { Prisma } from "@prisma/client";
export class AdminNotificationServiceError extends Error {
    statusCode;
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
        this.name = "AdminNotificationServiceError";
    }
}
class AdminNotificationService {
    isPushConfigured() {
        return Boolean(process.env.VAPID_PUBLIC_KEY &&
            process.env.VAPID_PRIVATE_KEY &&
            process.env.VAPID_SUBJECT);
    }
    configurePush() {
        if (!this.isPushConfigured()) {
            console.warn("[Admin Notifications] VAPID keys are not configured. " +
                "Database notifications will still work.");
            return false;
        }
        try {
            webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
            return true;
        }
        catch (error) {
            console.error("[Admin Notifications] VAPID configuration failed:", error);
            return false;
        }
    }
    /**
     * Retrieve notifications and unread count for one admin.
     */
    async getNotifications(adminId) {
        const [notifications, unreadCount] = await Promise.all([
            prisma.adminNotification.findMany({
                where: { adminId },
                orderBy: { createdAt: "desc" },
                take: 50,
            }),
            prisma.adminNotification.count({
                where: { adminId, readAt: null },
            }),
        ]);
        return { notifications, unreadCount };
    }
    /**
     * Mark one notification as read.
     */
    async markAsRead(adminId, notificationId) {
        const result = await prisma.adminNotification.updateMany({
            where: {
                id: notificationId,
                adminId,
                readAt: null,
            },
            data: { readAt: new Date() },
        });
        if (result.count === 0) {
            const existing = await prisma.adminNotification.findFirst({
                where: { id: notificationId, adminId },
                select: { id: true },
            });
            if (!existing) {
                throw new AdminNotificationServiceError("Notification not found.", 404);
            }
        }
        const unreadCount = await prisma.adminNotification.count({
            where: { adminId, readAt: null },
        });
        return { unreadCount };
    }
    /**
     * Mark all notifications as read for one admin.
     */
    async markAllAsRead(adminId) {
        const result = await prisma.adminNotification.updateMany({
            where: { adminId, readAt: null },
            data: { readAt: new Date() },
        });
        return {
            updatedCount: result.count,
            unreadCount: 0,
        };
    }
    /**
     * Save a browser subscription without allowing one admin
     * to take ownership of another admin's endpoint.
     */
    async savePushSubscription(adminId, input) {
        const existing = await prisma.adminPushSubscription.findUnique({
            where: { endpoint: input.endpoint },
            select: { id: true, adminId: true },
        });
        if (existing && existing.adminId !== adminId) {
            throw new AdminNotificationServiceError("This push subscription belongs to another admin.", 409);
        }
        if (existing) {
            return prisma.adminPushSubscription.update({
                where: { endpoint: input.endpoint },
                data: {
                    p256dh: input.p256dh,
                    auth: input.auth,
                },
                select: {
                    id: true,
                    createdAt: true,
                    updatedAt: true,
                },
            });
        }
        return prisma.adminPushSubscription.create({
            data: {
                adminId,
                endpoint: input.endpoint,
                p256dh: input.p256dh,
                auth: input.auth,
            },
            select: {
                id: true,
                createdAt: true,
                updatedAt: true,
            },
        });
    }
    /**
     * Remove only the current admin's subscription.
     */
    async deletePushSubscription(adminId, endpoint) {
        const result = await prisma.adminPushSubscription.deleteMany({
            where: { adminId, endpoint },
        });
        return { deletedCount: result.count };
    }
    /**
     * Create one notification per admin.
     * The schema's unique constraint on (adminId, eventKey)
     * prevents repeated callbacks creating duplicate notifications.
     */
    async createForAllAdmins(input) {
        const admins = await prisma.user.findMany({
            where: { role: "ADMIN" },
            select: { id: true },
        });
        let created = 0;
        const notificationsToPush = [];
        for (const admin of admins) {
            try {
                const notification = await prisma.adminNotification.create({
                    data: {
                        adminId: admin.id,
                        eventKey: input.eventKey,
                        type: input.type,
                        title: input.title,
                        message: input.message,
                        ...(input.data !== undefined ? { data: input.data } : {}),
                    },
                    select: {
                        id: true,
                        adminId: true,
                    },
                });
                created++;
                notificationsToPush.push({
                    adminId: notification.adminId,
                    id: notification.id,
                });
            }
            catch (error) {
                if (error instanceof Prisma.PrismaClientKnownRequestError &&
                    error.code === "P2002") {
                    // Already created for this admin: don't send a duplicate push.
                    continue;
                }
                // Fail visibly rather than silently reporting a successful event.
                console.error(`[Admin Notifications] Failed to create notification for admin ${admin.id}:`, error);
                throw error;
            }
        }
        let pushSent = 0;
        if (created > 0 && this.configurePush()) {
            pushSent = await this.sendPushToAdmins(notificationsToPush, {
                title: input.title,
                body: input.message,
                type: input.type,
                ...(input.data !== undefined ? { data: input.data } : {}),
            });
        }
        return { created, pushSent };
    }
    /**
     * Deliver push messages and remove expired subscriptions.
     * Push failures are logged and do not roll back saved notifications.
     */
    async sendPushToAdmins(notifications, payload) {
        let sent = 0;
        for (const notification of notifications) {
            const subscriptions = await prisma.adminPushSubscription.findMany({
                where: { adminId: notification.adminId },
                select: {
                    endpoint: true,
                    p256dh: true,
                    auth: true,
                },
            });
            for (const subscription of subscriptions) {
                try {
                    await webpush.sendNotification({
                        endpoint: subscription.endpoint,
                        keys: {
                            p256dh: subscription.p256dh,
                            auth: subscription.auth,
                        },
                    }, JSON.stringify({
                        ...payload,
                        notificationId: notification.id,
                        url: "/admin",
                    }));
                    sent++;
                }
                catch (error) {
                    const statusCode = typeof error === "object" &&
                        error !== null &&
                        "statusCode" in error
                        ? error.statusCode
                        : undefined;
                    if (statusCode === 404 || statusCode === 410) {
                        try {
                            await prisma.adminPushSubscription.deleteMany({
                                where: { endpoint: subscription.endpoint },
                            });
                        }
                        catch (deleteError) {
                            console.error("[Admin Notifications] Failed to remove expired subscription:", deleteError);
                        }
                        continue;
                    }
                    console.error("[Admin Notifications] Push delivery failed:", statusCode ?? error);
                }
            }
        }
        return sent;
    }
}
export const adminNotificationService = new AdminNotificationService();
//# sourceMappingURL=admin-notification.service.js.map