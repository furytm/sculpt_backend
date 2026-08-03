import membershipService from "./membership.service.js";
class MembershipController {
    /**
     * GET /api/memberships
     */
    async getMemberships(req, res) {
        try {
            const memberships = await membershipService.getAllMemberships();
            return res.status(200).json({
                success: true,
                message: "Memberships retrieved successfully.",
                data: memberships,
            });
        }
        catch (error) {
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
    async getMembership(req, res) {
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
        }
        catch (error) {
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
    async createMembership(req, res) {
        try {
            const membership = await membershipService.createMembership(req.body);
            return res.status(201).json({
                success: true,
                message: "Membership created successfully.",
                data: membership,
            });
        }
        catch (error) {
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
    async updateMembership(req, res) {
        try {
            const { id } = req.params;
            const membership = await membershipService.updateMembership(id, req.body);
            return res.status(200).json({
                success: true,
                message: "Membership updated successfully.",
                data: membership,
            });
        }
        catch (error) {
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
    async deleteMembership(req, res) {
        try {
            const { id } = req.params;
            await membershipService.deleteMembership(id);
            return res.status(200).json({
                success: true,
                message: "Membership deactivated successfully.",
            });
        }
        catch (error) {
            console.error("Delete Membership Error:", error);
            return res.status(400).json({
                success: false,
                message: error?.message || "Failed to deactivate membership.",
            });
        }
    }
}
export default new MembershipController();
//# sourceMappingURL=membership.controller.js.map