
import { Booking } from "@prisma/client";

export enum PaymentStatus {
  PENDING = "PENDING",
  PAID = "PAID",
  FAILED = "FAILED",
}

export type PaymentMethod = "PAYMISH" | "OFFLINE" | "PAYSTACK";

export type BookingClassType = "GROUP" | "PRIVATE";

export interface HealthDeclarationDto {
  accepted: boolean;
  notes?: string;
}

export interface CreateBookingDto {
  fullName: string;
  email: string;
  phone: string;
  membershipId: string;

  /**
   * Optional class name, e.g. "Reformer".
   */
  classId?: string;

  /**
   * ID of the actual dated ClassSession.
   * Optional because a membership may be purchased
   * before the customer selects a session.
   */
  classSessionId?: string;

  /**
   * Backward-compatible field for clients that send
   * the dated session using scheduleId.
   * This must contain a ClassSession ID, not a Schedule ID.
   */
  scheduleId?: string;

  bookingDate?: string;

  paymentMethod: PaymentMethod;

  /**
   * Optional at purchase time for the new
   * membership-first flow. Required before booking
   * confirmation.
   */
  healthDeclaration?: HealthDeclarationDto;
}

export interface BookingResponse {
  booking: Booking | any;
  paymentMethod: PaymentMethod;
  authorizationUrl: string | null;
  bookingFlowToken?: string;
}

export interface HealthDeclarationResponse {
  accepted: boolean;
  declarationVersion: string;
  notes: string | null;
  acceptedAt: Date | null;
}

export interface AttachBookingAccountDto {
  bookingFlowToken: string;
}

export interface ConfirmBookingDto {
  bookingFlowToken?: string;
}

export interface ScheduleAvailability {
  id: string;
  classId?: string;
  className: string;
  tutorName: string;
  code: string;
  dayOfWeek:
    | "MONDAY"
    | "TUESDAY"
    | "WEDNESDAY"
    | "THURSDAY"
    | "FRIDAY"
    | "SATURDAY"
    | "SUNDAY";
  startTime: string;
  endTime: string;
  sessionDate: string | Date;
  capacity: number;
  bookedCount: number;
  availableSlots: number;
  isAvailable: boolean;
  status?: "OPEN" | "FULL" | "CANCELLED" | "COMPLETED";
}

export interface BookingFlowResponse {
  booking: Booking | any;
  healthDeclaration: HealthDeclarationResponse | null;
  selectedSchedule: ScheduleAvailability | null;
  bookingFlowToken?: string;
}

export interface CreateMemberClassBookingDto {
  classSessionId: string;
}

export interface HealthSafetyFormDto {
  dateOfBirth?: string;
  age?: number;
  emergencyContactName?: string;
  emergencyContactRelationship?: string;
  emergencyContactPhone?: string;
  pregnancy?: string;
  pregnancyWeeks?: number;
  dueDate?: string;
  pregnancyClearance?: string;
  postpartum?: string;
  deliveryDate?: string;
  postpartumClearance?: string;
  screeningAnswers?: Record<string, any>;
  surgery?: string;
  surgeryDetails?: string;
  surgeryClearance?: string;
  consent?: Record<string, any>;
  signature?: string;
}
