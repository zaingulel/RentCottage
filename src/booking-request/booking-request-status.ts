import { isTimestamp, rowObject } from "./booking-request-row";

export const bookingRequestStatuses = [
  "pending",
  "processing",
  "accepted",
  "declined",
  "withdrawn",
  "expired",
] as const;

export type BookingRequestStatus = (typeof bookingRequestStatuses)[number];

export function isBookingRequestStatus(
  value: unknown,
): value is BookingRequestStatus {
  return bookingRequestStatuses.includes(value as BookingRequestStatus);
}

export type BookingRequestPaymentStatus =
  | "capture-processing"
  | "payment-required"
  | "paid-confirmed";

export type BookingRequestNotificationStatus =
  | Exclude<BookingRequestStatus, "pending" | "processing">
  | "payment-required";

export type BookingRequestPaymentRequiredWindow = {
  readonly recordedAt: string;
  readonly deadline: string;
  readonly phase: "open" | "elapsed";
};

export type BookingRequestPaymentRequiredExpiry = {
  readonly status:
    | "processing"
    | "attention-required"
    | "refunding"
    | "quarantined"
    | "quarantined-released"
    | "expired"
    | "refunded-expired";
  readonly deadline: string;
};

export function paymentRequiredExpiryFrom(
  value: unknown,
  requestStatus: BookingRequestStatus,
  paymentStatus: BookingRequestPaymentStatus | null,
  window: BookingRequestPaymentRequiredWindow | null | undefined,
): BookingRequestPaymentRequiredExpiry | null | undefined {
  if (value === null) return null;
  const expiry = rowObject(value);
  if (!expiry) return;
  if (
    Object.keys(expiry).length !== 2 ||
    !isTimestamp(expiry.deadline) ||
    ![
      "processing",
      "attention-required",
      "refunding",
      "quarantined",
      "quarantined-released",
      "expired",
      "refunded-expired",
    ].includes(expiry.status as string)
  )
    return;
  if (
    expiry.status === "expired" ||
    expiry.status === "refunded-expired" ||
    expiry.status === "quarantined-released"
      ? requestStatus !== "expired" || paymentStatus !== null
      : requestStatus !== "accepted" ||
        paymentStatus !== "payment-required" ||
        !window ||
        (expiry.status !== "quarantined" && window.phase !== "elapsed") ||
        Date.parse(window.deadline) !== Date.parse(expiry.deadline)
  )
    return;
  return {
    status: expiry.status as BookingRequestPaymentRequiredExpiry["status"],
    deadline: expiry.deadline,
  };
}

export function isBookingRequestPaymentStatus(
  value: unknown,
  requestStatus: BookingRequestStatus,
): value is BookingRequestPaymentStatus | null {
  return (
    value === null ||
    (requestStatus === "accepted" &&
      (value === "capture-processing" ||
        value === "payment-required" ||
        value === "paid-confirmed"))
  );
}

export function isBookingRequestNotificationStatus(
  value: unknown,
): value is BookingRequestNotificationStatus {
  return (
    value === "payment-required" ||
    (isBookingRequestStatus(value) &&
      value !== "pending" &&
      value !== "processing")
  );
}

export function paymentRequiredWindowFrom(
  value: unknown,
  paymentStatus: BookingRequestPaymentStatus | null,
): BookingRequestPaymentRequiredWindow | null | undefined {
  if (paymentStatus !== "payment-required")
    return value === null ? null : undefined;
  const window = rowObject(value);
  if (!window) return;
  if (
    Object.keys(window).length !== 3 ||
    !["recordedAt", "deadline", "databaseNow"].every((key) => key in window) ||
    !isTimestamp(window.recordedAt) ||
    !isTimestamp(window.deadline) ||
    !isTimestamp(window.databaseNow) ||
    Date.parse(window.deadline) - Date.parse(window.recordedAt) !== 1_200_000
  )
    return;
  return {
    recordedAt: window.recordedAt,
    deadline: window.deadline,
    phase:
      Date.parse(window.databaseNow) < Date.parse(window.deadline)
        ? "open"
        : "elapsed",
  };
}
