import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.membership.deleteMany();

  await prisma.membership.createMany({
    data: [
      {
        slug: "intro-week",
        name: "1 Week Unlimited - Intro Offer",
        description: "Perfect for first-time clients to experience our studio",
        price: 69999,
        period: "7 days",
        classLimit: null,
        duration: "1 Week",
        autoRenew: false,
        highlighted: false,
        badge: "New Members",
        displayOrder: 1,
        features: [
          "Unlimited classes for 7 days",
          "Access to all class types",
          "First-time clients only",
          "Start on any date"
        ]
      },

      {
        slug: "founding-member",
        name: "Founding Member - Unlimited",
        description: "Locked-in rate for founding members",
        price: 350000,
        period: "/month",
        classLimit: null,
        duration: "Monthly",
        autoRenew: true,
        highlighted: true,
        badge: "Limited to 30",
        displayOrder: 2,
        features: [
          "Unlimited classes",
          "Rate locked for life",
          "Limited to first 30 members",
          "Auto-renewal",
          "Priority booking",
          "Exclusive founding member events"
        ]
      },

      {
        slug: "single-class",
        name: "Single Class Pass",
        description: "Try a class whenever you want",
        price: 10,
        period: "per class",
        classLimit: 1,
        duration: "Single",
        autoRenew: false,
        highlighted: false,
        badge: null,
        displayOrder: 3,
        features: [
          "1 class pass",
          "Access to all class types",
          "Valid for 30 days",
          "No commitment"
        ]
      },

      {
        slug: "monthly-5",
        name: "5 Classes/Month",
        description: "Perfect for casual practitioners",
        price: 90000,
        period: "/month",
        classLimit: 5,
        duration: "Monthly",
        autoRenew: true,
        highlighted: false,
        badge: null,
        displayOrder: 4,
        features: [
          "5 classes per month",
          "Access to all class types",
          "Unlimited class swaps",
          "Priority booking",
          "Auto-renewal"
        ]
      },

      {
        slug: "monthly-10",
        name: "10 Classes/Month",
        description: "Best for regular practitioners",
        price: 177000,
        period: "/month",
        classLimit: 10,
        duration: "Monthly",
        autoRenew: true,
        highlighted: false,
        badge: null,
        displayOrder: 5,
        features: [
          "10 classes per month",
          "Access to all class types",
          "Unlimited class swaps",
          "Priority booking",
          "10% off private sessions",
          "Monthly wellness workshop",
          "Auto-renewal"
        ]
      },

      {
        slug: "monthly-unlimited",
        name: "Unlimited Monthly",
        description: "For total commitment",
        price: 420000,
        period: "/month",
        classLimit: null,
        duration: "Monthly",
        autoRenew: true,
        highlighted: false,
        badge: null,
        displayOrder: 6,
        features: [
          "Unlimited classes",
          "Free private session (1/month)",
          "Priority booking",
          "20% off additional private sessions",
          "Monthly wellness workshop",
          "Exclusive member events",
          "Auto-renewal"
        ]
      },

      {
        slug: "quarterly-5",
        name: "5 Classes - Quarterly",
        description: "Flexible quarterly package",
        price: 109999,
        period: "3 months",
        classLimit: 5,
        duration: "Quarterly",
        autoRenew: false,
        highlighted: false,
        badge: null,
        displayOrder: 7,
        features: [
          "5 classes in 3 months",
          "Access to all class types",
          "Unlimited class swaps",
          "Valid for 3 months"
        ]
      },

      {
        slug: "quarterly-10",
        name: "10 Classes - Quarterly",
        description: "Great value for committed practitioners",
        price: 189999,
        period: "3 months",
        classLimit: 10,
        duration: "Quarterly",
        autoRenew: false,
        highlighted: false,
        badge: null,
        displayOrder: 8,
        features: [
          "10 classes in 3 months",
          "Access to all class types",
          "Unlimited class swaps",
          "Priority booking",
          "Valid for 3 months"
        ]
      },

      {
        slug: "quarterly-20",
        name: "20 Classes - Quarterly",
        description: "Best quarterly value",
        price: 360000,
        period: "3 months",
        classLimit: 20,
        duration: "Quarterly",
        autoRenew: false,
        highlighted: false,
        badge: null,
        displayOrder: 9,
        features: [
          "20 classes in 3 months",
          "Access to all class types",
          "Unlimited class swaps",
          "Priority booking",
          "Monthly wellness workshop",
          "Valid for 3 months"
        ]
      },

      {
        slug: "quarterly-48",
        name: "48 Classes - Quarterly (3x/week)",
        description: "Intensive program - ~3 classes per week",
        price: 840000,
        period: "3 months",
        classLimit: 48,
        duration: "Quarterly",
        autoRenew: false,
        highlighted: false,
        badge: null,
        displayOrder: 10,
        features: [
          "48 classes in 3 months (~3/week)",
          "Access to all class types",
          "Unlimited class swaps",
          "Priority booking",
          "Monthly wellness workshop",
          "Valid for 3 months"
        ]
      },

      {
        slug: "annual-unlimited",
        name: "Unlimited Annual",
        description: "Best value annual commitment",
        price: 2500000,
        period: "/year",
        classLimit: null,
        duration: "Annual",
        autoRenew: false,
        highlighted: false,
        badge: "Best Value",
        displayOrder: 11,
        features: [
          "Unlimited classes for 12 months",
          "Free private session (2/month)",
          "Priority booking",
          "20% off additional private sessions",
          "Monthly wellness workshop",
          "Exclusive member events",
          "Save over ₦500,000 vs monthly"
        ]
      }
    ]
  });

  console.log("✅ Memberships seeded successfully.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });