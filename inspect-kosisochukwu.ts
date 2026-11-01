import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const result = await prisma.user.findUnique({
  where: {
    email: "ogokosisochukwu@gmail.com",
  },
  include: {
    memberships: {
      include: {
        membership: true,
        membershipPurchase: true,
        activation: true,
      },
    },
    bookings: {
      where: {
        paymentReference: "SL-1792830055373-51f793e9",
      },
      include: {
        membershipActivation: true,
        memberMembership: {
          include: {
            activation: true,
          },
        },
      },
    },
  },
});

console.log(JSON.stringify(result, null, 2));