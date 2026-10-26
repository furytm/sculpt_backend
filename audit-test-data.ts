
import prisma from "./src/config/prisma.js";

const references = [
  "OFFLINE-1793000485651-6dd9cd16",
  "SL-1792997079476-6aa34ce0",
  "SL-1792996753095-a0e0f9e9",
  "SL-1792996167665-d06c5e67",
  "SL-1792995814578-35fef0e2",
  "SL-1792995648408-48c7af1e",
  "SL-1792995383586-b54ba955",
  "SL-1792995106960-cfce1399",
  "SL-1792994799763-c016f9fb",
  "SL-1792994784880-5f581ddf",
  "SL-1792994413998-d471f9f6",
  "SL-1792994296281-8b12e63d",
  "SL-1792994250022-ce6685c9",
  "SL-1792994236161-6180e865",
  "SL-1792993489057-b8ef91fa",
  "SL-1792992432565-699d0a88",
  "SL-1792991853943-78fb61fd",
  "SL-1792990484584-604e313a",
  "SL-1792982846300-6298166f",
  "SL-1792980958312-7ed1797d",
  "SL-1792980393597-7246ad01",
];

async function main() {
  const bookings = await prisma.booking.findMany({
    where: { paymentReference: { in: references } },
    select: {
      id: true,
      paymentReference: true,
      email: true,
      paymentStatus: true,
      bookingStatus: true,
    },
  });

  const bookingIds = bookings.map((b) => b.id);

  console.log("Matching bookings:", bookings.length);
  console.table(bookings);

  if (process.env.CONFIRM_DELETE_TEST_BOOKINGS !== "YES") {
    console.log(
      '\nDry run only. Set $env:CONFIRM_DELETE_TEST_BOOKINGS = "YES" ' +
      "to execute deletion."
    );
    return;
  }

  await prisma.$transaction(async (tx) => {
    if (!bookingIds.length) return;

    await tx.healthSafetyForm.deleteMany({
      where: { bookingId: { in: bookingIds } },
    });

    await tx.memberSchedule.deleteMany({
      where: { bookingId: { in: bookingIds } },
    });

    await tx.membershipActivation.deleteMany({
      where: { bookingId: { in: bookingIds } },
    });

    await tx.booking.deleteMany({
      where: { id: { in: bookingIds } },
    });
  });

  console.log("Deleted bookings:", bookingIds.length);
}

main()
  .catch((error) => {
    console.error("Cleanup failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
