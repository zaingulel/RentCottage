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
