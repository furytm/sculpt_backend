
import prisma from "./src/config/prisma.js";

async function repairMembershipLinks() {
  const activations = await prisma.membershipActivation.findMany({
    select: {
      bookingId: true,
      memberMembershipId: true,
      booking: {
        select: {
          id: true,
          memberMembershipId: true,
          paymentStatus: true,
          paymentMethod: true,
          bookingStatus: true,
        },
      },
    },
  });

  const candidates = activations.filter(
    (activation) =>
      activation.booking.paymentStatus === "PAID" &&
      activation.booking.paymentMethod === "OFFLINE" &&
      activation.booking.bookingStatus === "CONFIRMED" &&
      activation.booking.memberMembershipId === null
  );

  let repaired = 0;
  let skipped = 0;

  for (const activation of candidates) {
    const result = await prisma.booking.updateMany({
      where: {
        id: activation.bookingId,
        memberMembershipId: null,
      },
      data: {
        memberMembershipId: activation.memberMembershipId,
      },
    });

    if (result.count === 1) {
      repaired++;
    } else {
      skipped++;
    }
  }

  console.log({
    eligible: candidates.length,
    repaired,
    skipped,
  });

  const [linkedBookings, linkedMemberships] = await Promise.all([
    prisma.booking.count({
      where: {
        paymentStatus: "PAID",
        paymentMethod: "OFFLINE",
        bookingStatus: "CONFIRMED",
        memberMembershipId: { not: null },
      },
    }),
    prisma.memberMembership.count({
      where: {
        userId: { not: null },
      },
    }),
  ]);

  console.log({ linkedBookings, linkedMemberships });
}

repairMembershipLinks()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
