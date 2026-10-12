
import prisma from "./src/config/prisma.js";

async function main() {
  const bookings = await prisma.booking.findMany({
    where: {
      paymentStatus: "PENDING",
      bookingStatus: "PENDING",
    },
    select: {
      id: true,
      fullName: true,
      email: true,
      amount: true,
      paymentMethod: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  console.table(
    bookings.map((b) => ({
      id: b.id,
      name: b.fullName,
      email: b.email,
      amount: b.amount,
      method: b.paymentMethod,
      createdAt: b.createdAt.toISOString(),
    }))
  );

  console.log("Total pending bookings:", bookings.length);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
