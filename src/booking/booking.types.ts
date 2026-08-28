import { Booking } from "@prisma/client";
import type { Prisma } from "@prisma/client";

export enum PaymentStatus {
  PENDING = "PENDING",
  PAID = "PAID",
  FAILED = "FAILED",
}

export interface CreateBookingDto {
  fullName: string;
  email: string;
  phone: string;
  membershipId: string;
  classId?: string;
  scheduleId?: string;
  bookingDate?: Date;
}

export interface BookingResponse {
  booking: Booking;
  authorizationUrl: string;
}