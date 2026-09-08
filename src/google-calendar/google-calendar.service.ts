import { google } from "googleapis";

const GOOGLE_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;

const TIMEZONE =
  process.env.GOOGLE_CALENDAR_TIMEZONE || "Africa/Lagos";

class GoogleCalendarService {
  private getCalendar() {
    if (
      !GOOGLE_CALENDAR_ID ||
      !GOOGLE_CLIENT_ID ||
      !GOOGLE_CLIENT_SECRET ||
      !GOOGLE_REFRESH_TOKEN
    ) {
      throw new Error(
        "Google Calendar environment variables are not configured."
      );
    }

    const auth = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET
    );

    auth.setCredentials({
      refresh_token: GOOGLE_REFRESH_TOKEN,
    });

    return google.calendar({
      version: "v3",
      auth,
    });
  }

  /**
   * Create one weekly recurring Google Calendar event
   * for one selected schedule day.
   *
   * Example:
   * Monday 10:00–11:00
   * repeats every Monday until the membership expires.
   */
  async createRecurringBookingEvent(data: {
    bookingId: string;
    bookingReference: string;
    memberName: string;
    memberEmail: string;
    className: string;
    tutorName: string;
    bookingDate: Date;
    expiryDate: Date | null;
    dayOfWeek: string;
    startTime: string;
    endTime: string;
  }) {
    const calendar = this.getCalendar();

    // Find the first occurrence of this particular
    // schedule day on or after the selected start date.
    const firstOccurrence = this.getFirstOccurrence(
      data.bookingDate,
      data.dayOfWeek
    );

    const startDateTime = this.combineDateAndTime(
      firstOccurrence,
      data.startTime
    );

    const endDateTime = this.combineDateAndTime(
      firstOccurrence,
      data.endTime
    );

    const recurrenceDay =
      this.googleRecurrenceDay(data.dayOfWeek);

    const recurrenceRule = data.expiryDate
      ? `RRULE:FREQ=WEEKLY;BYDAY=${recurrenceDay};UNTIL=${this.formatUntilDate(
          data.expiryDate
        )}`
      : `RRULE:FREQ=WEEKLY;BYDAY=${recurrenceDay}`;

    const event = await calendar.events.insert({
      calendarId: GOOGLE_CALENDAR_ID!,
      sendUpdates: "none",

      requestBody: {
        summary: `Sculpt LAB — ${data.className}`,

        description: [
          "Sculpt LAB recurring booking",
          "",
          `Member: ${data.memberName}`,
          `Email: ${data.memberEmail}`,
          `Tutor: ${data.tutorName}`,
          `Class: ${data.className}`,
          `Recurring Day: ${data.dayOfWeek}`,
          `Booking Reference: ${data.bookingReference}`,
          `Booking ID: ${data.bookingId}`,
        ].join("\n"),

        start: {
          dateTime: startDateTime,
          timeZone: TIMEZONE,
        },

        end: {
          dateTime: endDateTime,
          timeZone: TIMEZONE,
        },

        recurrence: [recurrenceRule],

        extendedProperties: {
          private: {
            sculptBookingId: data.bookingId,
            sculptBookingReference: data.bookingReference,
            sculptDayOfWeek: data.dayOfWeek,
          },
        },
      },
    });

    return {
      eventId: event.data.id ?? null,
      eventUrl: event.data.htmlLink ?? null,
      dayOfWeek: data.dayOfWeek,
    };
  }

  /**
   * Find the first selected schedule day on or after
   * the member's chosen start date.
   *
   * Example:
   *
   * Start date: Monday
   * Selected day: Wednesday
   *
   * Result: Wednesday of that same week.
   */
  private getFirstOccurrence(
    startDate: Date,
    dayOfWeek: string
  ) {
    const targetDays: Record<string, number> = {
      SUNDAY: 0,
      MONDAY: 1,
      TUESDAY: 2,
      WEDNESDAY: 3,
      THURSDAY: 4,
      FRIDAY: 5,
      SATURDAY: 6,
    };

    const targetDay = targetDays[dayOfWeek];

    if (targetDay === undefined) {
      throw new Error(
        `Invalid day of week: ${dayOfWeek}`
      );
    }

    const date = new Date(startDate);

    const currentDay = date.getUTCDay();

    let difference = targetDay - currentDay;

    if (difference < 0) {
      difference += 7;
    }

    date.setUTCDate(
      date.getUTCDate() + difference
    );

    return date;
  }

  /**
   * Convert Prisma DayOfWeek to Google Calendar BYDAY.
   */
  private googleRecurrenceDay(dayOfWeek: string) {
    const days: Record<string, string> = {
      MONDAY: "MO",
      TUESDAY: "TU",
      WEDNESDAY: "WE",
      THURSDAY: "TH",
      FRIDAY: "FR",
      SATURDAY: "SA",
      SUNDAY: "SU",
    };

    const day = days[dayOfWeek];

    if (!day) {
      throw new Error(
        `Invalid day of week: ${dayOfWeek}`
      );
    }

    return day;
  }

  /**
   * Google Calendar RRULE UNTIL format.
   */
  private formatUntilDate(date: Date) {
    const year = date.getUTCFullYear();

    const month = String(
      date.getUTCMonth() + 1
    ).padStart(2, "0");

    const day = String(
      date.getUTCDate()
    ).padStart(2, "0");

    return `${year}${month}${day}T235959Z`;
  }

  /**
   * Combine a date with a schedule time.
   */
  private combineDateAndTime(
    date: Date,
    time: string
  ) {
    const year = date.getUTCFullYear();

    const month = String(
      date.getUTCMonth() + 1
    ).padStart(2, "0");

    const day = String(
      date.getUTCDate()
    ).padStart(2, "0");

    const normalizedTime =
      time.length === 5
        ? `${time}:00`
        : time;

    return `${year}-${month}-${day}T${normalizedTime}`;
  }
}

export const googleCalendarService =
  new GoogleCalendarService();