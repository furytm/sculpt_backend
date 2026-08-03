import prisma from "../config/prisma.js";
class MembershipService {
    /**
     * Get all active memberships
     */
    async getAllMemberships() {
        return await prisma.membership.findMany({
            where: {
                isActive: true,
            },
            orderBy: {
                displayOrder: "asc",
            },
        });
    }
    /**
     * Get a membership by ID
     */
    async getMembershipById(id) {
        return await prisma.membership.findUnique({
            where: {
                id,
            },
        });
    }
    /**
     * Create a new membership
     */
    async createMembership(data) {
        return await prisma.membership.create({
            data: {
                name: data.name,
                slug: data.slug,
                description: data.description,
                price: data.price,
                period: data.period,
                classLimit: data.classLimit,
                duration: data.duration,
                features: data.features,
                highlighted: data.highlighted ?? false,
                badge: data.badge,
                displayOrder: data.displayOrder ?? 0,
                autoRenew: data.autoRenew ?? false,
                isActive: data.isActive ?? true,
            },
        });
    }
    /**
     * Update membership
     */
    async updateMembership(id, data) {
        const membership = await prisma.membership.findUnique({
            where: { id },
        });
        if (!membership) {
            throw new Error("Membership not found.");
        }
        return await prisma.membership.update({
            where: { id },
            data,
        });
    }
    /**
     * Soft delete membership
     */
    async deleteMembership(id) {
        const membership = await prisma.membership.findUnique({
            where: { id },
        });
        if (!membership) {
            throw new Error("Membership not found.");
        }
        return await prisma.membership.update({
            where: {
                id,
            },
            data: {
                isActive: false,
            },
        });
    }
}
export default new MembershipService();
//# sourceMappingURL=membership.service.js.map