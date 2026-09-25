// import "dotenv/config";
// import prisma from "./src/config/prisma.js";
// import { googleCalendarService } from "./src/google-calendar/google-calendar.service.js";
export {};
// async function testCalendarBooking() {
//   const bookingId = "cmugh9dod0007veccgc93q2wn";
//   try {
//     const booking = await prisma.booking.findUnique({
//       where: {
//         id: bookingId,
//       },
//       include: {
//         session: {
//           include: {
//             schedule: true,
//           },
//         },
//       },
//     });
//     if (!booking) {
//       throw new Error("Booking not found.");
//     }
//     if (!booking.session) {
//       throw new Error("Booking has no session.");
//     }
//     if (booking.calendarEventId) {
//       console.log("This booking already has a Calendar event:");
//       console.log(booking.calendarEventId);
//       console.log(booking.calendarEventUrl);
//       return;
//     }
//     const session = booking.session;
//     const schedule = session.schedule;
//     console.log("Creating Google Calendar event...");
//     console.log({
//       bookingId: booking.id,
//       memberName: booking.fullName,
//       memberEmail: booking.email,
//       className: schedule.className,
//       tutorName: schedule.tutorName,
//       sessionDate: session.sessionDate,
//       startTime: schedule.startTime,
//       endTime: schedule.endTime,
//     });
//     const calendarEvent =
//       await googleCalendarService.createBookingEvent({
//         bookingId: booking.id,
//         bookingReference: booking.paymentReference ?? booking.id,
//         memberName: booking.fullName,
//         memberEmail: booking.email,
//         className: schedule.className,
//         tutorName: schedule.tutorName,
//         sessionDate: session.sessionDate,
//         startTime: schedule.startTime,
//         endTime: schedule.endTime,
//       });
//     console.log("Google Calendar response:");
//     console.log(calendarEvent);
//     if (calendarEvent.eventId) {
//       await prisma.booking.update({
//         where: {
//           id: booking.id,
//         },
//         data: {
//           calendarEventId: calendarEvent.eventId,
//           calendarEventUrl: calendarEvent.eventUrl,
//         },
//       });
//       console.log("Booking updated successfully.");
//     }
//     console.log("DONE.");
//   } catch (error) {
//     console.error("CALENDAR TEST FAILED:");
//     console.error(error);
//   } finally {
//     await prisma.$disconnect();
//   }
// }
// testCalendarBooking();
//# sourceMappingURL=test-google-calendar.js.map