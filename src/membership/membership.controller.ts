import { Request, Response } from "express";
import membershipService from "./membership.service.js";
import { MembershipType } from "@prisma/client";

class MembershipController {
  /**
   * GET /api/memberships
   */
   async getMemberships(req: Request, res: Response) {
    try {
      const type = req.query.type as MembershipType | undefined;

      const memberships = await membershipService.getAllMemberships(type);

      return res.status(200).json({
        success: true,
        message: "Memberships retrieved successfully.",
        data: memberships,
      });
    } catch (error: any) {
      console.error("Get Memberships Error:", error);

      return res.status(500).json({
        success: false,
        message: error?.message || "Failed to retrieve memberships.",
      });
    }
  }


  /**
   * GET /api/memberships/:id
   */
  async getMembership(req: Request<{ id: string }>, res: Response) {
    try {
      const { id } = req.params;

      const membership = await membershipService.getMembershipById(id);

      if (!membership) {
        return res.status(404).json({
          success: false,
          message: "Membership not found.",
        });
      }

      return res.status(200).json({
        success: true,
        data: membership,
      });
    } catch (error: any) {
      console.error("Get Membership Error:", error);

      return res.status(500).json({
        success: false,
        message: error?.message || "Failed to retrieve membership.",
      });
    }
  }

  /**
   * POST /api/memberships
   */
  async createMembership(req: Request, res: Response) {
    try {
      const membership = await membershipService.createMembership(req.body);

      return res.status(201).json({
        success: true,
        message: "Membership created successfully.",
        data: membership,
      });
    } catch (error: any) {
      console.error("Create Membership Error:", error);

      return res.status(400).json({
        success: false,
        message: error?.message || "Failed to create membership.",
      });
    }
  }

  /**
   * PATCH /api/memberships/:id
   */
  async updateMembership(req: Request<{ id: string }>, res: Response) {
    try {
      const { id } = req.params;

      const membership = await membershipService.updateMembership(
        id,
        req.body
      );

      return res.status(200).json({
        success: true,
        message: "Membership updated successfully.",
        data: membership,
      });
    } catch (error: any) {
      console.error("Update Membership Error:", error);

      return res.status(400).json({
        success: false,
        message: error?.message || "Failed to update membership.",
      });
    }
  }

  /**
   * DELETE /api/memberships/:id
   * Soft delete (isActive = false)
   */
  async deleteMembership(req: Request<{ id: string }>, res: Response) {
    try {
      const { id } = req.params;

      await membershipService.deleteMembership(id);

      return res.status(200).json({
        success: true,
        message: "Membership deactivated successfully.",
      });
    } catch (error: any) {
      console.error("Delete Membership Error:", error);

      return res.status(400).json({
        success: false,
        message: error?.message || "Failed to deactivate membership.",
      });
    }
  }
}

export default new MembershipController();