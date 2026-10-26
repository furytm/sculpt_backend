import prisma from "../config/prisma.js";
class AdminNotificationController {
    getAdminId(req) {
        return req.user?.userId ?? req.user?.id ?? null;
    }
    // GET /api/admin/notifications
    getNotifications = async (req, res) => {
        try {
            const adminId = this.getAdminId(req);
            if (!adminId) {
                return res.status(401).json({
                    success: false,
                    message: "Authenticated admin ID was not found.",
                });
            }
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
            return res.status(200).json({
                success: true,
                data: {
                    notifications,
                    unreadCount,
                },
            });
        }
        catch (error) {
            console.error("Get Admin Notifications Error:", error);
            return res.status(500).json({
                success: false,
                message: "Failed to retrieve notifications.",
            });
        }
    };
    // PATCH /api/admin/notifications/:id/read
    markAsRead = async (req, res) => {
        try {
            const adminId = this.getAdminId(req);
            const notificationId = req.params.id;
            if (!adminId) {
                return res.status(401).json({
                    success: false,
                    message: "Authenticated admin ID was not found.",
                });
            }
            if (!notificationId || Array.isArray(notificationId)) {
                return res.status(400).json({
                    success: false,
                    message: "A valid notification ID is required.",
                });
            }
            const result = await prisma.adminNotification.updateMany({
                where: {
                    id: notificationId,
                    adminId,
                    readAt: null,
                },
                data: {
                    readAt: new Date(),
                },
            });
            if (result.count === 0) {
                const existing = await prisma.adminNotification.findFirst({
                    where: { id: notificationId, adminId },
                    select: { id: true, readAt: true },
                });
                if (!existing) {
                    return res.status(404).json({
                        success: false,
                        message: "Notification not found.",
                    });
                }
            }
            const unreadCount = await prisma.adminNotification.count({
                where: { adminId, readAt: null },
            });
            return res.status(200).json({
                success: true,
                message: "Notification marked as read.",
                data: { unreadCount },
            });
        }
        catch (error) {
            console.error("Mark Notification Read Error:", error);
            return res.status(500).json({
                success: false,
                message: "Failed to mark notification as read.",
            });
        }
    };
    // PATCH /api/admin/notifications/read-all
    markAllAsRead = async (req, res) => {
        try {
            const adminId = this.getAdminId(req);
            if (!adminId) {
                return res.status(401).json({
                    success: false,
                    message: "Authenticated admin ID was not found.",
                });
            }
            const result = await prisma.adminNotification.updateMany({
                where: {
                    adminId,
                    readAt: null,
                },
                data: {
                    readAt: new Date(),
                },
            });
            return res.status(200).json({
                success: true,
                message: "All notifications marked as read.",
                data: {
                    updatedCount: result.count,
                    unreadCount: 0,
                },
            });
        }
        catch (error) {
            console.error("Mark All Notifications Read Error:", error);
            return res.status(500).json({
                success: false,
                message: "Failed to mark all notifications as read.",
            });
        }
    };
    // POST /api/admin/notifications/push-subscription
    savePushSubscription = async (req, res) => {
        try {
            const adminId = this.getAdminId(req);
            const { endpoint, keys } = req.body ?? {};
            if (!adminId) {
                return res.status(401).json({
                    success: false,
                    message: "Authenticated admin ID was not found.",
                });
            }
            if (typeof endpoint !== "string" ||
                !endpoint.startsWith("https://") ||
                typeof keys?.p256dh !== "string" ||
                !keys.p256dh.trim() ||
                typeof keys?.auth !== "string" ||
                !keys.auth.trim()) {
                return res.status(400).json({
                    success: false,
                    message: "A valid push endpoint and subscription keys are required.",
                });
            }
            const subscription = await prisma.adminPushSubscription.upsert({
                where: { endpoint },
                create: {
                    adminId,
                    endpoint,
                    p256dh: keys.p256dh,
                    auth: keys.auth,
                },
                update: {
                    adminId,
                    p256dh: keys.p256dh,
                    auth: keys.auth,
                },
                select: {
                    id: true,
                    createdAt: true,
                    updatedAt: true,
                },
            });
            return res.status(200).json({
                success: true,
                message: "Push subscription saved.",
                data: subscription,
            });
        }
        catch (error) {
            console.error("Save Push Subscription Error:", error);
            return res.status(500).json({
                success: false,
                message: "Failed to save push subscription.",
            });
        }
    };
    // DELETE /api/admin/notifications/push-subscription
    deletePushSubscription = async (req, res) => {
        try {
            const adminId = this.getAdminId(req);
            const { endpoint } = req.body ?? {};
            if (!adminId) {
                return res.status(401).json({
                    success: false,
                    message: "Authenticated admin ID was not found.",
                });
            }
            if (typeof endpoint !== "string" || !endpoint.trim()) {
                return res.status(400).json({
                    success: false,
                    message: "The push subscription endpoint is required.",
                });
            }
            const result = await prisma.adminPushSubscription.deleteMany({
                where: {
                    adminId,
                    endpoint,
                },
            });
            return res.status(200).json({
                success: true,
                message: "Push subscription removed.",
                data: {
                    deletedCount: result.count,
                },
            });
        }
        catch (error) {
            console.error("Delete Push Subscription Error:", error);
            return res.status(500).json({
                success: false,
                message: "Failed to remove push subscription.",
            });
        }
    };
}
export default new AdminNotificationController();
//# sourceMappingURL=admin-notification.controller.js.map