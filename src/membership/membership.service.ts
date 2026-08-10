import prisma from "../config/prisma.js";
import { MembershipType } from "@prisma/client";

class MembershipService {
  /**
   * Get all active memberships
   */
  async getAllMemberships(type?: MembershipType) {
    return await prisma.membership.findMany({
      where: {
        isActive: true,
        ...(type && { type }),
      },
      orderBy: {
        displayOrder: "asc",
      },
    });
  }

  /**
   * Get a membership by ID
   */
 

  async getMembershipById(id: string) {
    return await prisma.membership.findUnique({
      where: {
        id,
      },
    });
  }
  /**
   * Create a new membership
   */
  async createMembership(data: {
    name: string;
    slug: string;
    description?: string;
    price: number;
    period: string;
      type: MembershipType;

    classLimit: number | null;
    duration: string;
    features: string[];
    highlighted?: boolean;
    badge?: string;
    displayOrder?: number;
    autoRenew?: boolean;
    isActive?: boolean;
  }) {
    return await prisma.membership.create({
      data: {
        name: data.name,
        slug: data.slug,
        description: data.description,
  type: data.type,
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
  async updateMembership(
    id: string,
    data: {
      name?: string;
      slug?: string;
      description?: string;
      price?: number;
      period?: string;
          type?: MembershipType;
      classLimit?: number | null;
      duration?: string;
      features?: string[];
      highlighted?: boolean;
      badge?: string;
      displayOrder?: number;
      autoRenew?: boolean;
      isActive?: boolean;
    }
  ) {
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
  async deleteMembership(id: string) {
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