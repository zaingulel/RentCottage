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
  | "paid-confirmed";

export function isBookingRequestPaymentStatus(
  value: unknown,
  requestStatus: BookingRequestStatus,
): value is BookingRequestPaymentStatus | null {
  return (
    value === null ||
    (requestStatus === "accepted" &&
      (value === "capture-processing" || value === "paid-confirmed"))
  );
}
