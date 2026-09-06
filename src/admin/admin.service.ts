import {
  PaymentMethod,
  PaymentStatus,
} from "@prisma/client";
import prisma from "../config/prisma.js";

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
}

export const adminService = new AdminService();