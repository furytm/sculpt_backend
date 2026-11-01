import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const reference = "SL-1792830055373-51f793e9";

  const [purchase, booking, healthForm] = await Promise.all([
    prisma.membershipPurchase.findUnique({
      where: { paymentReference: reference },
      include: {
        membership: true,
        memberMembership: true,
      },
    }),

    prisma.booking.findUnique({
      where: { paymentReference: reference },
      include: {
        memberMembership: true,
        healthSafetyForm: true,
      },
    }),

    prisma.healthSafetyForm.findFirst({
      where: {
        booking: {
          paymentReference: reference,
        },
      },
    }),
  ]);

  console.log(
    JSON.stringify(
      {
        existingPurchase: purchase,
        existingBooking: booking,
        healthSafetyForm: healthForm,
      },
      null,
      2
    )
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());