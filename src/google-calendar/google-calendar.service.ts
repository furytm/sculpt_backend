import { google } from "googleapis";

const GOOGLE_CALENDAR_ID =
  process.env.GOOGLE_CALENDAR_ID;

const GOOGLE_CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID;

const GOOGLE_CLIENT_SECRET =
  process.env.GOOGLE_CLIENT_SECRET;

const GOOGLE_REFRESH_TOKEN =
  process.env.GOOGLE_REFRESH_TOKEN;

const TIMEZONE =
  process.env.GOOGLE_CALENDAR_TIMEZONE ||
  "Africa/Lagos";

class GoogleCalendarService {
  /**
   * Create authenticated Google Calendar client.
   *
   * IMPORTANT:
   * This uses the Sculpt LAB calendar account's
   * refresh token.
   *
   * It is separate from member Google Login.
   */
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
   * Create ONE Google Calendar event for ONE
   * selected ClassSession.
   *
   * This is NOT recurring.
   */
  async createBookingEvent(data: {
    bookingId: string;
    bookingReference: string;

    memberName: string;
    memberEmail: string;

    className: string;
    tutorName: string;

    sessionDate: Date;
    startTime: string;
    endTime: string;
  }) {
    const calendar = this.getCalendar();

    const startDate = this.getLagosDate(
      data.sessionDate
    );

    const startDateTime =
      this.combineDateAndTime(
        startDate,
        data.startTime
      );

    const endDateTime =
      this.combineDateAndTime(
        startDate,
        data.endTime
      );

    const event =
      await calendar.events.insert({
        calendarId: GOOGLE_CALENDAR_ID!,
        sendUpdates: "none",

        requestBody: {
          summary:
            `Sculpt LAB — ${data.className}`,

          description: [
            "Sculpt LAB Class Booking",
            "",
            `Member: ${data.memberName}`,
            `Email: ${data.memberEmail}`,
            `Class: ${data.className}`,
            `Instructor: ${data.tutorName}`,
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

          extendedProperties: {
            private: {
              sculptBookingId:
                data.bookingId,

              sculptBookingReference:
                data.bookingReference,
            },
          },
        },
      });

    return {
      eventId: event.data.id ?? null,

      eventUrl:
        event.data.htmlLink ?? null,
    };
  }

  /**
   * Delete a Google Calendar event.
   *
   * Used when a booking is cancelled or deleted.
   */
  async deleteBookingEvent(
    eventId: string
  ) {
    if (!eventId) {
      return;
    }

    const calendar = this.getCalendar();

    try {
      await calendar.events.delete({
        calendarId:
          GOOGLE_CALENDAR_ID!,

        eventId,

        sendUpdates: "none",
      });

      console.log(
        `✅ Google Calendar event ${eventId} deleted.`
      );
    } catch (error: any) {
      /**
       * Google returns 404 when the event has already
       * been deleted manually.
       *
       * We treat that as harmless.
       */
      if (
        error?.code === 404 ||
        error?.response?.status === 404
      ) {
        console.log(
          `ℹ️ Google Calendar event ${eventId} was already deleted.`
        );

        return;
      }

      throw error;
    }
  }

  /**
   * Convert the ClassSession date into the calendar
   * date we need in Lagos.
   */
  private getLagosDate(date: Date) {
    return new Date(date);
  }

  /**
   * Combine a calendar date with a schedule time.
   *
   * Supports:
   * 06:00
   * 18:00
   * 6:00 PM
   * 06:00 PM
   */
  private combineDateAndTime(
    date: Date,
    time: string
  ) {
    const year =
      date.getUTCFullYear();

    const month = String(
      date.getUTCMonth() + 1
    ).padStart(2, "0");

    const day = String(
      date.getUTCDate()
    ).padStart(2, "0");

    const normalized =
      this.normalizeTime(time);

    return `${year}-${month}-${day}T${normalized}`;
  }

  /**
   * Normalize schedule time to HH:mm:ss.
   */
  private normalizeTime(time: string) {
    const value =
      time.trim().toUpperCase();

    /**
     * 24-hour format.
     */
    const twentyFourHour =
      value.match(
        /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/
      );

    if (twentyFourHour) {
      const hour =
        String(
          Number(twentyFourHour[1])
        ).padStart(2, "0");

      const minute =
        twentyFourHour[2];

      const second =
        twentyFourHour[3] ?? "00";

      return `${hour}:${minute}:${second}`;
    }

    /**
     * 12-hour format.
     *
     * Examples:
     * 6:00 PM
     * 06:00 PM
     */
    const twelveHour =
      value.match(
        /^(\d{1,2}):(\d{2})\s*(AM|PM)$/
      );

    if (twelveHour) {
      let hour =
        Number(twelveHour[1]);

      const minute =
        twelveHour[2];

      const period =
        twelveHour[3];

      if (
        period === "PM" &&
        hour !== 12
      ) {
        hour += 12;
      }

      if (
        period === "AM" &&
        hour === 12
      ) {
        hour = 0;
      }

      return `${String(hour).padStart(
        2,
        "0"
      )}:${minute}:00`;
    }

    throw new Error(
      `Invalid schedule time: ${time}`
    );
  }
}

export const googleCalendarService =
  new GoogleCalendarService();