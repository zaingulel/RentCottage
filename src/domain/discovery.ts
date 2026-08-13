export const areaKeys = ["north", "orchards", "highlands"] as const;
export type AreaKey = (typeof areaKeys)[number];

export function isAreaKey(value: string): value is AreaKey {
  return areaKeys.includes(value as AreaKey);
}

export const amenityKeys = [
  "pool",
  "garden",
  "ac",
  "net",
  "outside",
  "family",
] as const;
export type AmenityKey = (typeof amenityKeys)[number];

export function isAmenityKey(value: string): value is AmenityKey {
  return amenityKeys.includes(value as AmenityKey);
}

export const bookingPeriodOptions = [
  "morning-shift",
  "evening-shift",
  "full-day",
] as const;
export type BookingPeriodOption = (typeof bookingPeriodOptions)[number];

export function isBookingPeriodOption(
  value: string,
): value is BookingPeriodOption {
  return bookingPeriodOptions.includes(value as BookingPeriodOption);
}
