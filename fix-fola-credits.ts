
import prisma from "./src/config/prisma.js";

async function main() {
  const membershipId = "cmvoyne5p000fd83l3smz54pd";
  const expectedBookingId = "cmvoynd9f000dd83l8c63w6jl";

  const membership = await prisma.memberMembership.findUnique({
    where: { id: membershipId },
    include: {
      membership: true,
      bookings: true,
    },
  });

  if (!membership) {
    throw new Error("Membership record not found.");
  }

  const isCorrectBooking = membership.bookings.some(
    (booking) =>
      booking.id === expectedBookingId &&
      booking.paymentReference ===
        "OFFLINE-1793001247971-15c0ba8b" &&
      booking.paymentStatus === "PAID"
  );

  if (!isCorrectBooking) {
    throw new Error(
      "Booking verification failed. No changes were made."
    );
  }

  if (
    membership.membership.name !== "5 Classes/Month" ||
    membership.creditsTotal !== 5
  ) {
    throw new Error(
      "Membership verification failed. No changes were made."
    );
  }

  const updated = await prisma.memberMembership.update({
    where: { id: membershipId },
    data: {
      creditsUsed: 1,
    },
  });

  console.log("Membership credits corrected successfully:");
  console.log({
    membershipId: updated.id,
    creditsTotal: updated.creditsTotal,
    creditsUsed: updated.creditsUsed,
    remainingCredits:
      updated.creditsTotal === null
        ? null
        : updated.creditsTotal - updated.creditsUsed,
  });
}

main()
  .catch((error) => {
    console.error("Credit correction failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
