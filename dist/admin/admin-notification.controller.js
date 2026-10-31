import { adminNotificationService, AdminNotificationServiceError, } from "./admin-notification.service.js";
class AdminNotificationController {
    getAdminId(req) {
        return req.user?.userId ?? req.user?.id ?? null;
    }
    handleError(res, error, operation, fallbackMessage) {
        console.error(`[Admin Notifications] ${operation}:`, error);
        if (error instanceof AdminNotificationServiceError) {
            return res.status(error.statusCode).json({
                success: false,
                message: error.message,
            });
        }
        return res.status(500).json({
            success: false,
            message: fallbackMessage,
        });
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
            const data = await adminNotificationService.getNotifications(adminId);
            return res.status(200).json({
                success: true,
                data,
            });
        }
        catch (error) {
            return this.handleError(res, error, "Get notifications", "Failed to retrieve notifications.");
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
            const data = await adminNotificationService.markAsRead(adminId, notificationId);
            return res.status(200).json({
                success: true,
                message: "Notification marked as read.",
                data,
            });
        }
        catch (error) {
            return this.handleError(res, error, "Mark notification as read", "Failed to mark notification as read.");
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
            const data = await adminNotificationService.markAllAsRead(adminId);
            return res.status(200).json({
                success: true,
                message: "All notifications marked as read.",
                data,
            });
        }
        catch (error) {
            return this.handleError(res, error, "Mark all notifications as read", "Failed to mark all notifications as read.");
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
            const data = await adminNotificationService.savePushSubscription(adminId, {
                endpoint,
                p256dh: keys.p256dh,
                auth: keys.auth,
            });
            return res.status(200).json({
                success: true,
                message: "Push subscription saved.",
                data,
            });
        }
        catch (error) {
            return this.handleError(res, error, "Save push subscription", "Failed to save push subscription.");
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
            const data = await adminNotificationService.deletePushSubscription(adminId, endpoint);
            return res.status(200).json({
                success: true,
                message: "Push subscription removed.",
                data,
            });
        }
        catch (error) {
            return this.handleError(res, error, "Delete push subscription", "Failed to remove push subscription.");
        }
    };
}
export default new AdminNotificationController();
//# sourceMappingURL=admin-notification.controller.js.map