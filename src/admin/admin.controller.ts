import { Request, Response } from "express";
import { adminService } from "./admin.service.js";

class AdminController {
  async getPendingOfflinePayments(
    req: Request,
    res: Response
  ) {
    try {
      const payments =
        await adminService.getPendingOfflinePayments();

      return res.status(200).json({
        success: true,
        data: payments,
      });
    } catch (error: any) {
      console.error(
        "Get Pending Offline Payments Error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          error?.message ||
          "Failed to fetch pending offline payments.",
      });
    }
  }
}

export const adminController =
  new AdminController();