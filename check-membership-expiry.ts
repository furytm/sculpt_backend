import prisma from "./src/config/prisma.js";

async function main() {
  const bookings = await prisma.booking.findMany({
    where: {
      paymentStatus: "PAID",
      createdAt: {
        gte: new Date("2026-10-23T00:00:00.000Z"),
        lt: new Date("2026-10-26T00:00:00.000Z"),
      },
    },
    include: {
      membership: true,
      memberMembership: true,
    },
    orderBy: { createdAt: "desc" },
  });

  console.dir(
    bookings.map((b) => ({
      bookingId: b.id,
      customer: b.fullName,
      email: b.email,
      paymentReference: b.paymentReference,
      paymentMethod: b.paymentMethod,
      paymentStatus: b.paymentStatus,
      bookingCreatedAt: b.createdAt,
      planName: b.membership.name,
      planDuration: b.membership.duration,
      classLimit: b.membership.classLimit,
      membershipStartDate: b.memberMembership?.startDate,
      membershipExpiryDate: b.memberMembership?.expiryDate,
    })),
    { depth: null }
  );
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });