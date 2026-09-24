import { Booking } from "@prisma/client";

export enum PaymentStatus {
  PENDING = "PENDING",
  PAID = "PAID",
  FAILED = "FAILED",
}

export type PaymentMethod = "PAYMISH"  | "OFFLINE";

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
   * Selected group class.
   * Required for GROUP memberships.
   */
  classId?: string;

  /**
   * Selected dated/available session.
   * Required for GROUP memberships in the new booking flow.
   */
  scheduleId?: string;

  /**
   * The date of the selected class session.
   */
  bookingDate?: string;

  paymentMethod: PaymentMethod;

  /**
   * Health & Safety acknowledgement is completed
   * before payment.
   */
  healthDeclaration: HealthDeclarationDto;
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

  /**
   * Actual date of this available class session.
   */
  sessionDate: string;

  capacity: number;
  bookedCount: number;
  availableSlots: number;
  isAvailable: boolean;
}

export interface BookingFlowResponse {
  booking: Booking | any;

  healthDeclaration: HealthDeclarationResponse | null;

  selectedSchedule: ScheduleAvailability | null;

  bookingFlowToken?: string;
}

/**
 * Used when a logged-in member wants to book
 * another class using an existing membership.
 */
export interface CreateMemberClassBookingDto {
  scheduleId: string;
  bookingDate: string;
}

/**
 * Used for the existing/legacy Health & Safety
 * form fields. Keep this because your database
 * still contains those fields.
 */
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