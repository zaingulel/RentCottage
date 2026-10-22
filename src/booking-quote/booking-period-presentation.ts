import type { PublicCottageInventoryUnit } from "@/cottage-discovery/supabase-cottage-discovery";

import {
  continuousFullDayAccess,
  type BookingQuoteItem,
} from "./booking-quote";

export type BookingPeriodPresentation = "morning-evening-v1" | "original-names";

export function bookingPeriodPresentationFrom(
  value: unknown,
  items: readonly BookingQuoteItem[],
): BookingPeriodPresentation | undefined {
  if (value === undefined || value === null || value === "original-names")
    return "original-names";
  if (
    value === "morning-evening-v1" &&
    !items.some((item) => item.kind === "shift" && item.position === 3)
  )
    return value;
  return undefined;
}

export function inventoryDayPresentation(
  units: readonly PublicCottageInventoryUnit[],
): BookingPeriodPresentation {
  if (
    units.length === 3 &&
    units.every((unit) => unit.serviceDay === units[0].serviceDay) &&
    units.filter((unit) => unit.kind === "shift" && unit.position === 1)
      .length === 1 &&
    units.filter((unit) => unit.kind === "shift" && unit.position === 2)
      .length === 1 &&
    units.filter((unit) => unit.kind === "full-day").length === 1
  )
    return "morning-evening-v1";
  return "original-names";
}

export function inventoryAccessBounds(unit: PublicCottageInventoryUnit): {
  startsAt: string;
  endsAt: string;
  crossesMidnight: boolean;
} {
  const crossesMidnight =
    unit.endTime < unit.startTime ||
    (unit.kind === "full-day" && unit.endTime === unit.startTime);
  let endDay = unit.serviceDay;
  if (crossesMidnight) {
    const date = new Date(`${unit.serviceDay}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    endDay = date.toISOString().slice(0, 10);
  }
  return {
    startsAt: `${unit.serviceDay}T${unit.startTime}:00+03:00`,
    endsAt: `${endDay}T${unit.endTime}:00+03:00`,
    crossesMidnight,
  };
}

export function bookingPeriodAccessGaps(
  items: readonly BookingQuoteItem[],
): Array<{ startsAt: string; endsAt: string }> {
  const ranges = [
    ...continuousFullDayAccess([...items]),
    ...items.filter((item) => item.kind === "shift"),
  ].sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  const gaps: Array<{ startsAt: string; endsAt: string }> = [];
  let coveredUntil: string | undefined;
  for (const range of ranges) {
    if (coveredUntil && coveredUntil < range.startsAt)
      gaps.push({ startsAt: coveredUntil, endsAt: range.startsAt });
    if (!coveredUntil || coveredUntil < range.endsAt)
      coveredUntil = range.endsAt;
  }
  return gaps;
}
