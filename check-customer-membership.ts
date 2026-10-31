import prisma from "./src/config/prisma.js";

async function main() {
  const bookingId = "cmvm4q47t002bv83141lwrwg0";

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      membership: true,
      memberMembership: true,
      user: true,
    },
  });

  if (!booking) {
    throw new Error("Booking not found.");
  }

  console.dir(
    {
      bookingId: booking.id,
      customer: booking.fullName,
      email: booking.email,
      paymentDate: booking.createdAt,
      plan: booking.membership.name,
      duration: booking.membership.duration,
      classLimit: booking.membership.classLimit,
      userId: booking.userId,
      linkedMembership: booking.memberMembership,
      user: booking.user,
    },
    { depth: null }
  );

  const memberships = await prisma.memberMembership.findMany({
    where: {
      membershipId: booking.membershipId,
      OR: [
        ...(booking.userId ? [{ userId: booking.userId }] : []),
      ],
    },
    include: { membership: true },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  console.log("Customer membership records:");
  console.dir(memberships, { depth: null });
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
  