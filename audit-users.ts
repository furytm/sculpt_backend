import prisma from "./src/config/prisma.js";

async function main() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      role: true,
      provider: true,
      isEmailVerified: true,
      createdAt: true,

      _count: {
        select: {
          bookings: true,
          memberships: true,
          membershipPurchases: true,
          healthSafetyForms: true,
          memberSchedules: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  console.table(
    users.map((user) => ({
      id: user.id,
      name: user.fullName,
      email: user.email,
      phone: user.phone,
      role: user.role,
      verified: user.isEmailVerified,
      createdAt: user.createdAt.toISOString(),
      bookings: user._count.bookings,
      memberships: user._count.memberships,
      purchases: user._count.membershipPurchases,
      healthForms: user._count.healthSafetyForms,
      schedules: user._count.memberSchedules,
    }))
  );
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });