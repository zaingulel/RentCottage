import type { CustomerBookingRequest } from "./customer-booking-request";
import type { OwnerBookingRequestNotification } from "./owner-booking-request-notifications";
import {
  isBookingRequestStatus,
  type BookingRequestPaymentStatus,
  type BookingRequestStatus,
} from "./booking-request-status";

export type BookingRequestDisplayStatus =
  | BookingRequestStatus
  | BookingRequestPaymentStatus;

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
): status is BookingRequestPaymentStatus {
  return !isBookingRequestStatus(status);
}

export function shouldRefreshBookingRequestStatus(
  status: BookingRequestDisplayStatus,
): boolean {
  return (
    status === "pending" ||
    status === "processing" ||
    status === "capture-processing"
  );
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
