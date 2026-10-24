import type { CustomerBookingRequest } from "./customer-booking-request";
import type { OwnerBookingRequestNotification } from "./owner-booking-request-notifications";
import {
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
  "status" | "paymentStatus" | "cancellationStatus"
> & {
  readonly status: BookingRequestDisplayStatus | "cancelled";
};

export function isPaymentDisplayStatus(
  status: BookingRequestDisplayStatus | "cancelled",
): status is BookingRequestPaymentStatus {
  return (
    status === "capture-processing" ||
    status === "payment-required" ||
    status === "paid-confirmed"
  );
}

export function shouldRefreshBookingRequestStatus(
  status: BookingRequestDisplayStatus | "cancelled",
): boolean {
  return (
    status === "pending" ||
    status === "processing" ||
    status === "capture-processing" ||
    status === "payment-required"
  );
}

export function isWaitingBookingRequest(request: {
  readonly status: BookingRequestDisplayStatus | "cancelled";
}): boolean {
  return request.status === "pending";
}

export function waitingBookingRequestCount(
  requests: readonly {
    readonly status: BookingRequestDisplayStatus | "cancelled";
  }[],
): number {
  return requests.filter(isWaitingBookingRequest).length;
}

export function customerBookingRequestDisplay({
  paymentStatus,
  ...request
}: CustomerBookingRequest): CustomerBookingRequestDisplay {
  return { ...request, status: paymentStatus ?? request.status };
}
export function ownerBookingRequestNotificationDisplay({
  cancellationStatus,
  paymentStatus,
  ...notification
}: OwnerBookingRequestNotification): OwnerBookingRequestNotificationDisplay {
  return {
    ...notification,
    status: cancellationStatus ?? paymentStatus ?? notification.status,
  };
}

export function canRecoverBookingRequestPayment(
  request: Pick<
    CustomerBookingRequestDisplay,
    | "status"
    | "paymentRequiredWindow"
    | "paymentRequiredExpiry"
    | "paymentRecovery"
  >,
): boolean {
  return (
    request.status === "payment-required" &&
    request.paymentRequiredExpiry === null &&
    request.paymentRequiredWindow?.phase === "open" &&
    (request.paymentRecovery?.status === "available" ||
      request.paymentRecovery?.status === "retryable")
  );
}
