
import prisma from "./src/config/prisma.js";

const EMAIL = "me@jemimabenson.com";
const PURCHASE_REFERENCE = "SL-1795452244202-35bf5f55";

async function main() {
  console.log("\n=== JEMIMA BOOKING READINESS CHECK ===\n");

  // 1. Find Jemima's existing account.
  const user = await prisma.user.findUnique({
    where: { email: EMAIL },
    select: {
      id: true,
      email: true,
      role: true,
      isEmailVerified: true,
    },
  });

  if (!user) {
    throw new Error("Jemima's account was not found.");
  }

  console.log("1. USER ACCOUNT");
  console.log(user);

  // 2. Verify the recovered purchase.
  const purchase = await prisma.membershipPurchase.findUnique({
    where: { paymentReference: PURCHASE_REFERENCE },
    select: {
      id: true,
      userId: true,
      paymentReference: true,
      paymentStatus: true,
      type: true,
      firstSessionId: true,
      firstClassId: true,
      membershipId: true,
    },
  });

  console.log("\n2. RECOVERED PURCHASE");
  console.log(purchase);

  if (
    !purchase ||
    purchase.paymentStatus !== "PAID" ||
    purchase.userId !== user.id
  ) {
    throw new Error("Recovered purchase is not correctly linked.");
  }

  // 3. Find the membership created for this exact purchase.
  const membership = await prisma.memberMembership.findUnique({
    where: {
      membershipPurchaseId: purchase.id,
    },
    include: {
      membership: true,
    },
  });

  console.log("\n3. MEMBERSHIP");
  if (!membership) {
    throw new Error("No membership is linked to the recovered purchase.");
  }

  const remainingCredits =
    membership.creditsTotal === null
      ? null
      : membership.creditsTotal - membership.creditsUsed;

  console.log({
    id: membership.id,
    userId: membership.userId,
    status: membership.status,
    membershipNumber: membership.membershipNumber,
    plan: membership.membership.name,
    planType: membership.membership.type,
    classLimit: membership.membership.classLimit,
    startDate: membership.startDate,
    expiryDate: membership.expiryDate,
    creditsTotal: membership.creditsTotal,
    creditsUsed: membership.creditsUsed,
    remainingCredits,
  });

  // 4. Check for bookings already associated with this membership.

const bookings = await prisma.booking.findMany({
  where: {
    memberMembershipId: membership.id,
  },
  select: {
    id: true,
    paymentReference: true,
    bookingStatus: true,
    paymentStatus: true,
    sessionId: true,
    createdAt: true,
  },
  orderBy: {
    createdAt: "desc",
  },
});


  console.log("\n4. BOOKINGS LINKED TO THIS MEMBERSHIP");
  console.log(bookings);

 
  // 5. Check future Reformer Stretch sessions.
  // ClassSession has no isActive or startTime field.
  // Those schedule details belong to Schedule.

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const sessions = await prisma.classSession.findMany({
    where: {
      status: "OPEN",
      sessionDate: {
        gte: today,
      },
      schedule: {
        isActive: true,
        className: {
          contains: "Reformer Stretch",
          mode: "insensitive",
        },
      },
    },
    include: {
      schedule: true,
      _count: {
        select: {
          bookings: {
            where: {
              bookingStatus: "CONFIRMED",
            },
          },
        },
      },
    },
    orderBy: [
      { sessionDate: "asc" },
      { schedule: { startTime: "asc" } },
    ],
    take: 10,
  });

  console.log("\n5. FUTURE REFORMER STRETCH SESSIONS");

  console.table(
    sessions.map((session) => {
      const capacity =
        session.capacity ?? session.schedule.capacity;

      return {
        sessionId: session.id,
        date: session.sessionDate,
        startTime: session.schedule.startTime,
        className: session.schedule.className,
        capacity,
        confirmedBookings: session._count.bookings,
        remainingCapacity:
          capacity - session._count.bookings,
        scheduleActive: session.schedule.isActive,
        sessionStatus: session.status,
      };
    })
  );

  // 6. Final readiness assessment.
  const checks = {
    accountLinked: membership.userId === user.id,
    purchasePaid: purchase.paymentStatus === "PAID",
    membershipActive: membership.status === "ACTIVE",
    hasAvailableCredit:
      remainingCredits === null ||
      (remainingCredits !== null && remainingCredits > 0),
    firstSessionCleared: purchase.firstSessionId === null,
  };

  console.log("\n6. READINESS CHECKS");
  console.table(checks);

  console.log("\nNOTE:");
  console.log(
    "This script does not call the booking endpoint or test booking confirmation."
  );
  console.log(
    "A successful result confirms database readiness, not the complete booking flow."
  );
}

main()
  .catch((error) => {
    console.error("\nCHECK FAILED:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
