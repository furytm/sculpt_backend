
import prisma from "./src/config/prisma.js";

async function main() {
  const [
    bookings,
    purchases,
    memberships,
    activations,
    healthForms,
    memberSchedules,
  ] = await Promise.all([
    prisma.booking.findMany({
      select: {
        id: true,
        fullName: true,
        email: true,
        userId: true,
        amount: true,
        paymentStatus: true,
        bookingStatus: true,
        paymentMethod: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),

    prisma.membershipPurchase.findMany({
      select: {
        id: true,
        userId: true,
        amount: true,
        type: true,
        paymentStatus: true,
        user: { select: { email: true } },
      },
    }),

    prisma.memberMembership.findMany({
      select: {
        id: true,
        userId: true,
        membershipId: true,
        status: true,
        user: { select: { email: true } },
      },
    }),

    prisma.membershipActivation.count(),
    prisma.healthSafetyForm.count(),
    prisma.memberSchedule.count(),
  ]);

  console.log("\n=== REMAINING BOOKINGS ===");
  console.table(bookings.map((b) => ({
    id: b.id,
    name: b.fullName,
    email: b.email,
    userId: b.userId,
    amount: b.amount,
    payment: b.paymentStatus,
    booking: b.bookingStatus,
    method: b.paymentMethod,
    createdAt: b.createdAt.toISOString(),
  })));

  console.log("\n=== REMAINING MEMBERSHIP PURCHASES ===");
  console.table(purchases.map((p) => ({
    id: p.id,
    email: p.user.email,
    userId: p.userId,
    amount: p.amount,
    type: p.type,
    payment: p.paymentStatus,
  })));

  console.log("\n=== REMAINING MEMBER MEMBERSHIPS ===");
  console.table(memberships.map((m) => ({
    id: m.id,
    email: m.user?.email ?? "(no linked user)",
    userId: m.userId,
    membershipId: m.membershipId,
    status: m.status,
  })));

  console.log("\n=== OTHER RELATED RECORD COUNTS ===");
  console.log({
    bookings: bookings.length,
    purchases: purchases.length,
    memberMemberships: memberships.length,
    activations,
    healthForms,
    memberSchedules,
  });
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
