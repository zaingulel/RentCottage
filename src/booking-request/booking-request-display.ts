import type { CustomerBookingRequest } from "./customer-booking-request";
import type { OwnerBookingRequestNotification } from "./owner-booking-request-notifications";
import type { BookingRequestStatus } from "./booking-request-status";

export type BookingRequestDisplayStatus =
  | BookingRequestStatus
  | "capture-processing"
  | "paid-confirmed";

export type CustomerBookingRequestDisplay = Omit<
  CustomerBookingRequest,
  "status"
> & {
  readonly status: BookingRequestDisplayStatus;
};

export type OwnerBookingRequestNotificationDisplay = Omit<
  OwnerBookingRequestNotification,
  "status"
> & {
  readonly status: BookingRequestDisplayStatus;
};

export function isPaymentDisplayStatus(
  status: BookingRequestDisplayStatus,
): status is "capture-processing" | "paid-confirmed" {
  return status === "capture-processing" || status === "paid-confirmed";
}
