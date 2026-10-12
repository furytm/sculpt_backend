
import prisma from "./src/config/prisma.js";

async function main() {
  const activations = await prisma.membershipActivation.findMany({
    select: {
      id: true,
      bookingId: true,
      memberMembershipId: true,
      membershipNumber: true,
      usedAt: true,
      expiresAt: true,
      booking: {
        select: {
          id: true,
          fullName: true,
          email: true,
          amount: true,
          paymentStatus: true,
          bookingStatus: true,
          paymentMethod: true,
          createdAt: true,
        },
      },
      memberMembership: {
        select: {
          id: true,
          userId: true,
          status: true,
          membership: {
            select: {
              name: true,
              price: true,
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  console.table(
    activations.map((a) => ({
      activationId: a.id,
      bookingId: a.bookingId,
      membershipId: a.memberMembershipId,
      membershipNumber: a.membershipNumber,
      usedAt: a.usedAt,
      expiresAt: a.expiresAt,
      customer: a.booking.fullName,
      email: a.booking.email,
      amount: a.booking.amount,
      payment: a.booking.paymentStatus,
      bookingStatus: a.booking.bookingStatus,
      method: a.booking.paymentMethod,
      membership: a.memberMembership.membership.name,
      membershipStatus: a.memberMembership.status,
      createdAt: a.booking.createdAt,
    }))
  );
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
