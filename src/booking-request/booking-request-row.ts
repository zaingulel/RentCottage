import type { BookingQuoteItem } from "@/booking-quote/booking-quote";

const offsetSuffixPattern = /(?:Z|[+-]\d{2}:\d{2})$/;

export function rowObject(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return;
  }
  return value as Record<string, unknown>;
}

export function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function isOffsetTimestamp(value: unknown): value is string {
  return isTimestamp(value) && offsetSuffixPattern.test(value);
}

export function cloneBookingPeriod(
  items: readonly BookingQuoteItem[],
): BookingQuoteItem[] {
  return items.map((item) =>
    item.kind === "shift"
      ? {
          serviceDay: item.serviceDay,
          displayName: item.displayName,
          startsAt: item.startsAt,
          endsAt: item.endsAt,
          crossesMidnight: item.crossesMidnight,
          priceIqd: item.priceIqd,
          kind: "shift",
          position: item.position,
        }
      : {
          serviceDay: item.serviceDay,
          displayName: item.displayName,
          startsAt: item.startsAt,
          endsAt: item.endsAt,
          crossesMidnight: item.crossesMidnight,
          priceIqd: item.priceIqd,
          kind: "full-day",
        },
  );
}
