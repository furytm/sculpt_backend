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
  // classId?: string;
  // scheduleId?: string;
  // bookingDate?: Date;
}

export interface BookingResponse {
  booking: Booking;
  authorizationUrl: string;
}


export interface UpdateBookingScheduleDto {
  scheduleId: string;
}
export class UpdateBookingClassDto {
  classId!: string;
}
export interface UpdateBookingStartDateDto {
  startDate: string;
}
export interface UpdateBookingPreferencesDto {
  classId: string;
  preferredStartDate: string;
  availableDays: string[];
  preferredTimes: string[];
}
export interface HealthSafetyFormDto {
  dateOfBirth?: string;
  age?: number;

  emergencyContactName?: string;
  emergencyContactRelationship?: string;
  emergencyContactPhone?: string;

  pregnancy?: "Yes" | "No";
  pregnancyWeeks?: number;
  dueDate?: string;
  pregnancyClearance?: "Yes" | "No";

  postpartum?: "Yes" | "No";
  deliveryDate?: string;
  postpartumClearance?: "Yes" | "No";

  screeningAnswers?: Record<
    string,
    string | boolean
  >;

  surgery?: "Yes" | "No";
  surgeryDetails?: string;
  surgeryClearance?: "Yes" | "No";

  consent?: string[];

  signature?: string;

}