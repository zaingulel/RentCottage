import type { CustomerBookingRequest } from "./customer-booking-request";
import type { OwnerBookingRequestNotification } from "./owner-booking-request-notifications";
import type { BookingRequestStatus } from "./booking-request-status";

export type BookingRequestDisplayStatus =
  | BookingRequestStatus
  | "capture-processing"
  | "paid-confirmed";

export type CustomerBookingRequestDisplay = Omit<
  CustomerBookingRequest,
  "status" | "paymentStatus"
> & {
  readonly status: BookingRequestDisplayStatus;
};

export type OwnerBookingRequestNotificationDisplay = Omit<
  OwnerBookingRequestNotification,
  "status" | "paymentStatus"
> & {
  readonly status: BookingRequestDisplayStatus;
};

export function isPaymentDisplayStatus(
  status: BookingRequestDisplayStatus,
): status is "capture-processing" | "paid-confirmed" {
  return status === "capture-processing" || status === "paid-confirmed";
}

export function customerBookingRequestDisplay({
  paymentStatus,
  ...request
}: CustomerBookingRequest): CustomerBookingRequestDisplay {
  return { ...request, status: paymentStatus ?? request.status };
}
export function ownerBookingRequestNotificationDisplay({
  paymentStatus,
  ...notification
}: OwnerBookingRequestNotification): OwnerBookingRequestNotificationDisplay {
  return { ...notification, status: paymentStatus ?? notification.status };
}
