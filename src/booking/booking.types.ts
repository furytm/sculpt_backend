import { Booking } from "@prisma/client";

export enum PaymentStatus {
  PENDING = "PENDING",
  PAID = "PAID",
  FAILED = "FAILED",
}

export type PaymentMethod = "PAYMISH" | "OFFLINE";

export interface CreateBookingDto {
  fullName: string;
  email: string;
  phone: string;

  /**
   * Selected before payment
   */
  membershipId: string;
  classId?: string;

  /**
   * The customer selects the recurring schedule
   * after payment, so this normally starts as undefined.
   */
  scheduleId?: string;

  bookingDate?: string;

  paymentMethod: PaymentMethod;
}

export interface BookingResponse {
  booking: Booking | any;
  paymentMethod: PaymentMethod;
  authorizationUrl: string | null;

  /**
   * Temporary token used to securely continue the
   * booking flow before the customer creates/logs in
   * to an account.
   */
  bookingFlowToken?: string;
}

export interface UpdateBookingPreferencesDto {
  classId?: string;
  preferredStartDate?: string;
  availableDays?: string[];
  preferredTimes?: string[];
}
/**
 * Used when the customer selects a recurring
 * schedule during the booking flow.
 */
export interface UpdateBookingScheduleDto {
  scheduleId: string;
}

/**
 * Used when the customer chooses their membership
 * start date.
 */
export interface UpdateBookingStartDateDto {
  startDate: string;
}

/**
 * New Health Declaration
 *
 * This replaces the old detailed medical questionnaire.
 */
export interface HealthDeclarationDto {
  accepted: boolean;
  notes?: string;
}

/**
 * Data stored when the customer accepts
 * the Health Declaration.
 */
export interface HealthDeclarationResponse {
  accepted: boolean;
  declarationVersion: string;
  notes: string | null;
  acceptedAt: Date | null;
}

/**
 * Used after registration/login to connect the
 * pre-account booking to the authenticated user.
 */
export interface AttachBookingAccountDto {
  bookingFlowToken: string;
}

/**
 * Data required when finally confirming
 * the booking.
 */
export interface ConfirmBookingDto {
  bookingFlowToken?: string;
}

/**
 * Schedule availability returned to the frontend.
 *
 * Capacity is determined by the backend.
 * The frontend should NOT hardcode capacity.
 */
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

  isActive: boolean;

  capacity: number;
  bookedCount: number;
  availableSlots: number;
  isAvailable: boolean;
}

/**
 * Complete booking-flow state returned to the
 * frontend when the customer continues a booking.
 */
export interface BookingFlowResponse {
  booking: Booking | any;

  healthDeclaration: HealthDeclarationResponse | null;

  selectedSchedule: ScheduleAvailability | null;

  bookingFlowToken?: string;
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