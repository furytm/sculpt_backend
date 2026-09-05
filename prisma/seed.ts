import {
  PrismaClient,
  DayOfWeek,
  MembershipType,
} from "@prisma/client";

const prisma = new PrismaClient();

const memberships = [
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
      type: MembershipType.GROUP,
    badge: "New Members",
    displayOrder: 1,
    features: [
      "Unlimited classes for 7 days",
      "Access to all class types",
      "First-time clients only",
      "Start on any date",
    ],
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
    type: MembershipType.GROUP,
    badge: "Limited to 30",
    displayOrder: 2,
    features: [
      "Unlimited classes",
      "Rate locked for life",
      "Limited to first 30 members",
      "Auto-renewal",
      "Priority booking",
      "Exclusive founding member events",
    ],
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
    type: MembershipType.GROUP,
    badge: null,
    displayOrder: 3,
    features: [
      "1 class pass",
      "Access to all class types",
      "Valid for 30 days",
      "No commitment",
    ],
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
    type: MembershipType.GROUP,
    badge: null,
    displayOrder: 4,
    features: [
      "5 classes per month",
      "Access to all class types",
      "Unlimited class swaps",
      "Priority booking",
      "Auto-renewal",
    ],
  },

  {
    slug: "monthly-10",
    name: "10 Classes/Month",
    description: "Best for regular practitioners",
    price: 165000,
    period: "/month",
    classLimit: 10,
    duration: "Monthly",
    autoRenew: true,
    highlighted: false,
    type: MembershipType.GROUP,
    badge: null,
    displayOrder: 5,
    features: [
      "10 classes per month",
      "Access to all class types",
      "Unlimited class swaps",
      "Priority booking",
      "10% off private sessions",
      "Monthly wellness workshop",
      "Auto-renewal",
    ],
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
    type: MembershipType.GROUP,
    badge: null,
    displayOrder: 6,
    features: [
      "Unlimited classes",
      "Free private session (1/month)",
      "Priority booking",
      "20% off additional private sessions",
      "Monthly wellness workshop",
      "Exclusive member events",
      "Auto-renewal",
    ],
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
    type: MembershipType.GROUP,
    badge: null,
    displayOrder: 7,
    features: [
      "5 classes in 3 months",
      "Access to all class types",
      "Unlimited class swaps",
      "Valid for 3 months",
    ],
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
    type: MembershipType.GROUP,
    badge: null,
    displayOrder: 8,
    features: [
      "10 classes in 3 months",
      "Access to all class types",
      "Unlimited class swaps",
      "Priority booking",
      "Valid for 3 months",
    ],
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
     type: MembershipType.GROUP,
    badge: null,
    displayOrder: 9,
    features: [
      "20 classes in 3 months",
      "Access to all class types",
      "Unlimited class swaps",
      "Priority booking",
      "Monthly wellness workshop",
      "Valid for 3 months",
    ],
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
    type: MembershipType.GROUP,
    badge: null,
    displayOrder: 10,
    features: [
      "48 classes in 3 months (~3/week)",
      "Access to all class types",
      "Unlimited class swaps",
      "Priority booking",
      "Monthly wellness workshop",
      "Valid for 3 months",
    ],
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
    type: MembershipType.GROUP,
    badge: "Best Value",
    displayOrder: 11,
    features: [
      "Unlimited classes for 12 months",
      "Free private session (2/month)",
      "Priority booking",
      "20% off additional private sessions",
      "Monthly wellness workshop",
      "Exclusive member events",
      "Save over ₦500,000 vs monthly",
    ],
  },

  {
    slug: "private-single",
   type: MembershipType.PRIVATE,
    name: "Single Private Session",
    description:
      "One private reformer pilates session with a dedicated instructor.",
    price: 75000,
    period: "per session",
    classLimit: 1,
    duration: "Single",
    autoRenew: false,
    highlighted: false,
    badge: null,
    displayOrder: 12,
    features: [
      "1 private session",
      "Dedicated instructor",
      "Personalised workout",
      "Flexible scheduling",
    ],
  },

  {
    slug: "private-5",
type: MembershipType.PRIVATE,
    name: "5 Private Sessions",
    description:
      "Ideal for clients wanting consistent one-on-one coaching.",
    price: 350000,
    period: "package",
    classLimit: 5,
    duration: "Package",
    autoRenew: false,
    highlighted: false,
    badge: null,
    displayOrder: 13,
    features: [
      "5 private sessions",
      "Dedicated instructor",
      "Personalised workout plan",
      "Flexible scheduling",
    ],
  },

  {
    slug: "private-10",
  type: MembershipType.PRIVATE,
    name: "10 Private Sessions",
    description: "Best value for regular private training.",
    price: 650000,
    period: "package",
    classLimit: 10,
    duration: "Package",
    autoRenew: false,
    highlighted: true,
    badge: "Best Value",
    displayOrder: 14,
    features: [
      "10 private sessions",
      "Dedicated instructor",
      "Personalised workout plan",
      "Priority scheduling",
    ],
  },
];

const schedules = [
  // MONDAY
  {
    code: "MON-10-INTERMEDIATE",
    dayOfWeek: DayOfWeek.MONDAY,
    startTime: "10:00",
    endTime: "11:00",
    tutorName: "Betty",
    className: "Intermediate",
  },
  {
    code: "MON-11-BEGINNER",
    dayOfWeek: DayOfWeek.MONDAY,
    startTime: "11:00",
    endTime: "12:00",
    tutorName: "Betty",
    className: "Beginner",
  },
  {
    code: "MON-12-BEGINNER",
    dayOfWeek: DayOfWeek.MONDAY,
    startTime: "12:00",
    endTime: "13:00",
    tutorName: "Betty",
    className: "Beginner",
  },
  {
    code: "MON-13-INTERMEDIATE",
    dayOfWeek: DayOfWeek.MONDAY,
    startTime: "13:00",
    endTime: "14:00",
    tutorName: "Betty",
    className: "Intermediate",
  },

  // TUESDAY
  {
    code: "TUE-07-INTERMEDIATE",
    dayOfWeek: DayOfWeek.TUESDAY,
    startTime: "07:00",
    endTime: "08:00",
    tutorName: "Betty",
    className: "Intermediate",
  },
  {
    code: "TUE-08-REFORMER-STRETCH",
    dayOfWeek: DayOfWeek.TUESDAY,
    startTime: "08:00",
    endTime: "09:00",
    tutorName: "Betty",
    className: "Reformer Stretch",
  },
  {
    code: "TUE-09-BEGINNER",
    dayOfWeek: DayOfWeek.TUESDAY,
    startTime: "09:00",
    endTime: "10:00",
    tutorName: "Betty",
    className: "Beginner",
  },
  {
    code: "TUE-11-INTERMEDIATE",
    dayOfWeek: DayOfWeek.TUESDAY,
    startTime: "11:00",
    endTime: "12:00",
    tutorName: "Betty",
    className: "Intermediate",
  },
  {
    code: "TUE-14-BEGINNER",
    dayOfWeek: DayOfWeek.TUESDAY,
    startTime: "14:00",
    endTime: "15:00",
    tutorName: "Hope",
    className: "Beginner",
  },
  {
    code: "TUE-15-PILATES-STRENGTH",
    dayOfWeek: DayOfWeek.TUESDAY,
    startTime: "15:00",
    endTime: "16:00",
    tutorName: "Hope",
    className: "Pilates + Strength",
  },
  {
    code: "TUE-16-INTERMEDIATE",
    dayOfWeek: DayOfWeek.TUESDAY,
    startTime: "16:00",
    endTime: "17:00",
    tutorName: "Hope",
    className: "Intermediate",
  },
  {
    code: "TUE-17-BEGINNER",
    dayOfWeek: DayOfWeek.TUESDAY,
    startTime: "17:00",
    endTime: "18:00",
    tutorName: "Hope",
    className: "Beginner",
  },

  // WEDNESDAY
  {
    code: "WED-09-INTERMEDIATE",
    dayOfWeek: DayOfWeek.WEDNESDAY,
    startTime: "09:00",
    endTime: "10:00",
    tutorName: "Betty",
    className: "Intermediate",
  },
  {
    code: "WED-16-INTERMEDIATE",
    dayOfWeek: DayOfWeek.WEDNESDAY,
    startTime: "16:00",
    endTime: "17:00",
    tutorName: "Betty",
    className: "Intermediate",
  },
  {
    code: "WED-17-BEGINNER",
    dayOfWeek: DayOfWeek.WEDNESDAY,
    startTime: "17:00",
    endTime: "18:00",
    tutorName: "Betty",
    className: "Beginner",
  },
  {
    code: "WED-18-BEGINNER",
    dayOfWeek: DayOfWeek.WEDNESDAY,
    startTime: "18:00",
    endTime: "19:00",
    tutorName: "Betty",
    className: "Beginner",
  },

  // THURSDAY
  {
    code: "THU-08-PILATES-STRENGTH",
    dayOfWeek: DayOfWeek.THURSDAY,
    startTime: "08:00",
    endTime: "09:00",
    tutorName: "Betty",
    className: "Pilates + Strength",
  },
  {
    code: "THU-09-INTERMEDIATE",
    dayOfWeek: DayOfWeek.THURSDAY,
    startTime: "09:00",
    endTime: "10:00",
    tutorName: "Betty",
    className: "Intermediate",
  },
  {
    code: "THU-10-PILATES-STRENGTH",
    dayOfWeek: DayOfWeek.THURSDAY,
    startTime: "10:00",
    endTime: "11:00",
    tutorName: "Betty",
    className: "Pilates + Strength",
  },
  {
    code: "THU-11-BEGINNER",
    dayOfWeek: DayOfWeek.THURSDAY,
    startTime: "11:00",
    endTime: "12:00",
    tutorName: "Betty",
    className: "Beginner",
  },
  {
    code: "THU-15-INTERMEDIATE",
    dayOfWeek: DayOfWeek.THURSDAY,
    startTime: "15:00",
    endTime: "16:00",
    tutorName: "Hope",
    className: "Intermediate",
  },
  {
    code: "THU-16-BEGINNER",
    dayOfWeek: DayOfWeek.THURSDAY,
    startTime: "16:00",
    endTime: "17:00",
    tutorName: "Hope",
    className: "Beginner",
  },

  // FRIDAY
  {
    code: "FRI-11-BEGINNER",
    dayOfWeek: DayOfWeek.FRIDAY,
    startTime: "11:00",
    endTime: "12:00",
    tutorName: "Hope",
    className: "Beginner",
  },
  {
    code: "FRI-12-INTERMEDIATE",
    dayOfWeek: DayOfWeek.FRIDAY,
    startTime: "12:00",
    endTime: "13:00",
    tutorName: "Hope",
    className: "Intermediate",
  },
  {
    code: "FRI-13-REFORMER-STRETCH",
    dayOfWeek: DayOfWeek.FRIDAY,
    startTime: "13:00",
    endTime: "14:00",
    tutorName: "Hope",
    className: "Reformer Stretch",
  },
  {
    code: "FRI-14-BEGINNER",
    dayOfWeek: DayOfWeek.FRIDAY,
    startTime: "14:00",
    endTime: "15:00",
    tutorName: "Hope",
    className: "Beginner",
  },

  // SATURDAY
  {
    code: "SAT-07-BEGINNER",
    dayOfWeek: DayOfWeek.SATURDAY,
    startTime: "07:00",
    endTime: "08:00",
    tutorName: "Betty",
    className: "Beginner",
  },
  {
    code: "SAT-08-INTERMEDIATE",
    dayOfWeek: DayOfWeek.SATURDAY,
    startTime: "08:00",
    endTime: "09:00",
    tutorName: "Betty",
    className: "Intermediate",
  },
  {
    code: "SAT-09-BEGINNER",
    dayOfWeek: DayOfWeek.SATURDAY,
    startTime: "09:00",
    endTime: "10:00",
    tutorName: "Betty",
    className: "Beginner",
  },
  {
    code: "SAT-10-PILATES-STRENGTH",
    dayOfWeek: DayOfWeek.SATURDAY,
    startTime: "10:00",
    endTime: "11:00",
    tutorName: "Betty",
    className: "Pilates + Strength",
  },
];

async function main() {
  console.log("🌱 Starting database seed...");

  // ==========================================
  // MEMBERSHIPS
  // ==========================================

  for (const membership of memberships) {
    await prisma.membership.upsert({
      where: {
        slug: membership.slug,
      },

      update: {
        name: membership.name,
        description: membership.description,
        type: membership.type,
        price: membership.price,
        period: membership.period,
        classLimit: membership.classLimit,
        duration: membership.duration,
        features: membership.features,
        highlighted: membership.highlighted,
        badge: membership.badge,
        displayOrder: membership.displayOrder,
        autoRenew: membership.autoRenew,
      },

      create: membership,
    });
  }

  console.log("✅ Memberships seeded.");

  // ==========================================
  // SCHEDULES
  // ==========================================

  for (const schedule of schedules) {
    await prisma.schedule.upsert({
      where: {
        code: schedule.code,
      },

      update: {
        className: schedule.className,
        tutorName: schedule.tutorName,
        dayOfWeek: schedule.dayOfWeek,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        isActive: true,
      },

      create: {
        code: schedule.code,
        className: schedule.className,
        tutorName: schedule.tutorName,
        dayOfWeek: schedule.dayOfWeek,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        isActive: true,
      },
    });
  }

  console.log("✅ Schedules seeded.");
  console.log("🌱 Database seed completed.");
}

main()
  .catch((error) => {
    console.error("❌ Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });