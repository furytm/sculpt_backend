import { google } from "googleapis";
const GOOGLE_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
const TIMEZONE = process.env.GOOGLE_CALENDAR_TIMEZONE || "Africa/Lagos";
class GoogleCalendarService {
    getCalendar() {
        if (!GOOGLE_CALENDAR_ID ||
            !GOOGLE_CLIENT_ID ||
            !GOOGLE_CLIENT_SECRET ||
            !GOOGLE_REFRESH_TOKEN) {
            throw new Error("Google Calendar environment variables are not configured.");
        }
        const auth = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
        auth.setCredentials({
            refresh_token: GOOGLE_REFRESH_TOKEN,
        });
        return google.calendar({
            version: "v3",
            auth,
        });
    }
    async createBookingEvent(data) {
        const calendar = this.getCalendar();
        const startDateTime = this.combineDateAndTime(data.bookingDate, data.startTime);
        const endDateTime = this.combineDateAndTime(data.bookingDate, data.endTime);
        const event = await calendar.events.insert({
            calendarId: GOOGLE_CALENDAR_ID,
            sendUpdates: "none",
            requestBody: {
                summary: `Sculpt LAB — ${data.className}`,
                description: [
                    "New Sculpt LAB booking",
                    "",
                    `Member: ${data.memberName}`,
                    `Email: ${data.memberEmail}`,
                    `Tutor: ${data.tutorName}`,
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
                        sculptBookingId: data.bookingId,
                        sculptBookingReference: data.bookingReference,
                    },
                },
            },
        });
        return {
            eventId: event.data.id ?? null,
            eventUrl: event.data.htmlLink ?? null,
        };
    }
    async deleteEvent(eventId) {
        const calendar = this.getCalendar();
        await calendar.events.delete({
            calendarId: GOOGLE_CALENDAR_ID,
            eventId,
        });
    }
    async updateEvent(eventId, data) {
        const calendar = this.getCalendar();
        const existingEvent = await calendar.events.get({
            calendarId: GOOGLE_CALENDAR_ID,
            eventId,
        });
        const current = existingEvent.data;
        const updatedEvent = {
            ...current,
            summary: data.className
                ? `Sculpt LAB — ${data.className}`
                : current.summary,
            description: [
                "Sculpt LAB booking",
                "",
                `Member: ${data.memberName ?? ""}`,
                `Email: ${data.memberEmail ?? ""}`,
                `Tutor: ${data.tutorName ?? ""}`,
                `Booking Reference: ${data.bookingReference ?? ""}`,
                `Booking ID: ${data.bookingId ?? ""}`,
            ].join("\n"),
        };
        if (data.bookingDate &&
            data.startTime &&
            data.endTime) {
            updatedEvent.start = {
                dateTime: this.combineDateAndTime(data.bookingDate, data.startTime),
                timeZone: TIMEZONE,
            };
            updatedEvent.end = {
                dateTime: this.combineDateAndTime(data.bookingDate, data.endTime),
                timeZone: TIMEZONE,
            };
        }
        const event = await calendar.events.update({
            calendarId: GOOGLE_CALENDAR_ID,
            eventId,
            requestBody: updatedEvent,
            sendUpdates: "none",
        });
        return {
            eventId: event.data.id ?? null,
            eventUrl: event.data.htmlLink ?? null,
        };
    }
    combineDateAndTime(date, time) {
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, "0");
        const day = String(date.getUTCDate()).padStart(2, "0");
        const normalizedTime = time.length === 5 ? `${time}:00` : time;
        return `${year}-${month}-${day}T${normalizedTime}`;
    }
}
export const googleCalendarService = new GoogleCalendarService();
//# sourceMappingURL=google-calendar.service.js.map