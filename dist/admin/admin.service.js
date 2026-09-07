import { PaymentMethod, PaymentStatus, } from "@prisma/client";
import prisma from "../config/prisma.js";
import { membershipActivationService } from "../membership-activation/membership-activation.service.js";
class AdminService {
    async getPendingOfflinePayments() {
        return prisma.booking.findMany({
            where: {
                paymentMethod: PaymentMethod.OFFLINE,
                paymentStatus: PaymentStatus.PENDING,
            },
            include: {
                membership: true,
                memberSchedules: {
                    where: {
                        isActive: true,
                    },
                    include: {
                        schedule: true,
                    },
                },
                healthSafetyForm: true,
                user: true,
            },
            orderBy: {
                createdAt: "desc",
            },
        });
    }
    async confirmOfflinePayment(bookingId) {
        const booking = await prisma.booking.findUnique({
            where: {
                id: bookingId,
            },
            include: {
                membership: true,
                memberMembership: true,
                user: true,
                membershipActivation: true,
            },
        });
        if (!booking) {
            throw new Error("Booking not found.");
        }
        if (booking.paymentMethod !== PaymentMethod.OFFLINE) {
            throw new Error("This booking is not an offline payment.");
        }
        if (booking.paymentStatus === PaymentStatus.PAID) {
            throw new Error("This payment has already been confirmed.");
        }
        if (booking.paymentStatus !== PaymentStatus.PENDING) {
            throw new Error("Only pending payments can be confirmed.");
        }
        await prisma.booking.update({
            where: {
                id: booking.id,
            },
            data: {
                paymentStatus: PaymentStatus.PAID,
            },
        });
        try {
            const activation = await membershipActivationService.createActivationForBooking(booking.id);
            return activation;
        }
        catch (error) {
            // If membership/activation/email fails,
            // don't leave the payment incorrectly marked as PAID.
            await prisma.booking.update({
                where: {
                    id: booking.id,
                },
                data: {
                    paymentStatus: PaymentStatus.PENDING,
                },
            });
            throw error;
        }
    }
    async getPaymentDetails(bookingId) {
        const booking = await prisma.booking.findUnique({
            where: {
                id: bookingId,
            },
            include: {
                membership: true,
                user: true,
                memberMembership: true,
                membershipActivation: true,
                schedule: true,
                memberSchedules: {
                    include: {
                        schedule: true,
                    },
                },
                healthSafetyForm: true,
            },
        });
        if (!booking) {
            throw new Error("Payment not found.");
        }
        return booking;
    }
    async rejectOfflinePayment(bookingId, reason) {
        const booking = await prisma.booking.findUnique({
            where: {
                id: bookingId,
            },
        });
        if (!booking) {
            throw new Error("Booking not found.");
        }
        if (booking.paymentMethod !== PaymentMethod.OFFLINE) {
            throw new Error("This booking is not an offline payment.");
        }
        if (booking.paymentStatus === PaymentStatus.PAID) {
            throw new Error("A paid payment cannot be rejected.");
        }
        if (booking.paymentStatus !== PaymentStatus.PENDING) {
            throw new Error("Only pending payments can be rejected.");
        }
        const updatedBooking = await prisma.booking.update({
            where: {
                id: booking.id,
            },
            data: {
                paymentStatus: PaymentStatus.FAILED,
            },
            include: {
                membership: true,
                user: true,
            },
        });
        return {
            booking: updatedBooking,
            reason: reason ||
                "Offline payment was not confirmed.",
        };
    }
}
export const adminService = new AdminService();
//# sourceMappingURL=admin.service.js.map