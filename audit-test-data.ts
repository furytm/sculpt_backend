
// import prisma from "./src/config/prisma.js";

// const references = [
//   "SL-1792791673242-aec9b2be",
//   "SL-1792791440956-8e4d1ea7",
//   "SL-1792791418445-aa65e985",
//   "SL-1792791414319-a4e6f80b",
//   "SL-1792791373819-0c151bd4",
//   "SL-1792791351589-b698f04f",
//   "SL-1792791342561-0834191e",
//   "SL-1792791337297-861ba70e",
//   "SL-1792791217018-8fe56987",
//   "SL-1792791213356-a23b7032",
//   "SL-1792791206467-a901beb0",
//   "SL-1792791200319-a2bead27",
//   "SL-1792472406611-b802c8af",
//   "SL-1792413789847-3ca8f2c6",
//   "SL-1792413768586-30cbb72f",
//   "SL-1792234392817-8c1796eb",
//   "SL-1791994498613-98eadfd8",
//   "SL-1791994027757-bec5a5ae",
//   "SL-1791993901045-bd66b7ca",
//   "SL-1791923417163-5a533af5",
//   "SL-1791880598376-a230540f",
//   "SL-1791799826987-d3084f22",
//   "SL-1791799300973-897aa64c",
//   "SL-1791799087262-de81eb43",
//   "SL-1791799018490-1eeccc25",
//   "SL-1791798971948-dee38bc5",
//   "SL-1791798796085-4cdd2769",
//   "SL-1791755516944-ff2dfadd",
//   "SL-1791747447258-01110f69",
//   "SL-1791487305243-bc7",
//   "SL-1789210054307",
//   "SL-1789136205748",
//   "SL-1788862873407",
//   "SL-1788862862210",
//   "SL-1788854474549",
//   "SL-1791288971563-1b760013",
//   "SL-1791169390793-2daec41d",
//   "SL-1790453451550-376d2503",
//   "SL-1790188346022",
//   "SL-1790187961120",
//   "SL-1790170079607",
// ];

// async function main() {
//   const bookings = await prisma.booking.findMany({
//     where: { paymentReference: { in: references } },
//     select: {
//       id: true,
//       paymentReference: true,
//       email: true,
//       paymentStatus: true,
//       bookingStatus: true,
//     },
//   });

//   const bookingIds = bookings.map((b) => b.id);

//   console.log("Matching bookings:", bookings.length);
//   console.table(bookings);

//   if (process.env.CONFIRM_DELETE_TEST_BOOKINGS !== "YES") {
//     console.log(
//       '\nDry run only. Set $env:CONFIRM_DELETE_TEST_BOOKINGS = "YES" ' +
//       "to execute deletion."
//     );
//     return;
//   }

//   await prisma.$transaction(async (tx) => {
//     if (!bookingIds.length) return;

//     await tx.healthSafetyForm.deleteMany({
//       where: { bookingId: { in: bookingIds } },
//     });

//     await tx.memberSchedule.deleteMany({
//       where: { bookingId: { in: bookingIds } },
//     });

//     await tx.membershipActivation.deleteMany({
//       where: { bookingId: { in: bookingIds } },
//     });

//     await tx.booking.deleteMany({
//       where: { id: { in: bookingIds } },
//     });
//   });

//   console.log("Deleted bookings:", bookingIds.length);
// }

// main()
//   .catch((error) => {
//     console.error("Cleanup failed:", error);
//     process.exitCode = 1;
//   })
//   .finally(async () => {
//     await prisma.$disconnect();
//   });
