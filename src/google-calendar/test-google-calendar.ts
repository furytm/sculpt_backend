import "dotenv/config";
import { googleCalendarService } from "./google-calendar.service.js";

async function testGoogleCalendar() {
  try {
    console.log("Testing Google Calendar...");

    const result =
      await googleCalendarService.createBookingEvent({
        bookingId: "TEST-BOOKING-001",
        bookingReference: "SL-TEST-001",
        memberName: "Sculpt LAB Test Member",
        memberEmail: "kanuemma367@gmail.com",
        className: "Reformer Pilates",
        tutorName: "Test Tutor",

        // September 10, 2026
        bookingDate: new Date(
          "2026-09-10T00:00:00.000Z"
        ),

        startTime: "10:00",
        endTime: "11:00",
      });

    console.log("✅ Google Calendar event created!");
    console.log(result);
  } catch (error) {
    console.error(
      "❌ Google Calendar test failed:",
      error
    );

    process.exit(1);
  }
}

testGoogleCalendar();