
// import prisma from "./src/config/prisma.js";

// const PAUL_EMAIL = "paul.opara.john@gmail.com";

// const PAUL_BOOKING_IDS = [
//   "cmu8mhiu50003g11ria486vgd",
//   "cmu8mhbpm0001g11ra414azya",
//   "cmu2s0zuy0003fp1sz04utdin",
//   "cmu2rzv160001fp1s7wlb3sx4",
//   "cmtyeb0830003fn1sox10xhxb",
//   "cmtye1arb0001fn1s0qild5a1",
// ];

// async function main() {
//   const bookings = await prisma.booking.findMany({
//     where: {
//       id: { in: PAUL_BOOKING_IDS },
//     },
//     select: {
//       id: true,
//       fullName: true,
//       email: true,
//       amount: true,
//       paymentStatus: true,
//       bookingStatus: true,
//       paymentMethod: true,
//     },
//   });

//   console.table(bookings);

//   if (bookings.length !== PAUL_BOOKING_IDS.length) {
//     throw new Error(
//       `Expected ${PAUL_BOOKING_IDS.length} bookings, but found ${bookings.length}. Nothing deleted.`
//     );
//   }

//   const invalidBooking = bookings.some(
//     (booking) =>
//       booking.email?.trim().toLowerCase() !== PAUL_EMAIL ||
//       !booking.fullName?.toLowerCase().includes("paul")
//   );

//   if (invalidBooking) {
//     throw new Error(
//       "A booking does not match Paul's name and email. Nothing deleted."
//     );
//   }

//   if (process.env.CONFIRM_DELETE_PAUL_TESTS !== "YES") {
//     console.log(
//       "\nDRY RUN: All six bookings match Paul. No records deleted."
//     );
//     console.log(
//       'To delete them, set $env:CONFIRM_DELETE_PAUL_TESTS = "YES" and run again.'
//     );
//     return;
//   }

//   const result = await prisma.booking.deleteMany({
//     where: {
//       id: { in: PAUL_BOOKING_IDS },
//       email: { equals: PAUL_EMAIL, mode: "insensitive" },
//     },
//   });

//   console.log(`\nDeleted ${result.count} of Paul's test bookings.`);
// }

// main()
//   .catch((error) => {
//     console.error("Cleanup failed:", error);
//     process.exitCode = 1;
//   })
//   .finally(async () => {
//     await prisma.$disconnect();
//   });
