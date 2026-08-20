import {
  cottageProfileAmenities,
  cottageProfileMaximumLengths,
} from "@/cottage-profile/cottage-profile";

export type ShiftPosition = 1 | 2 | 3;

export type CottageDiscoverySelection =
  | { serviceDay: string; kind: "shift"; position: ShiftPosition }
  | { serviceDay: string; kind: "full-day" };

export interface CottageDiscoveryQuery {
  from: string;
  to: string;
  selections: CottageDiscoverySelection[];
  guests: number;
  governorate?: string;
  area?: string;
  amenities: string[];
}

export type CottageDiscoveryQueryResult =
  | { status: "loaded"; query: CottageDiscoveryQuery }
  | { status: "invalid" };

type RawQuery = Record<string, string | string[] | undefined>;

const serviceDayPattern = /^\d{4}-\d{2}-\d{2}$/;
const selectionPattern = /^(\d{4}-\d{2}-\d{2}):(shift):([1-3])$/;
const fullDayPattern = /^(\d{4}-\d{2}-\d{2}):full-day$/;
const knownAmenities = new Set<string>(cottageProfileAmenities);
const acceptedKeys = new Set([
  "from",
  "to",
  "selection",
  "guests",
  "governorate",
  "area",
  "amenity",
]);
const maximumDefensiveServiceDays = 400;
const maximumDefensiveSelections = maximumDefensiveServiceDays * 3;

function scalar(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function repeated(value: string | string[] | undefined): string[] {
  if (typeof value === "string") return [value];
  return value ?? [];
}

function validFacet(value: string | undefined, maximumLength: number) {
  return (
    value === undefined || (value.length > 0 && value.length <= maximumLength)
  );
}

function isServiceDay(value: string): boolean {
  if (!serviceDayPattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
}

function nextServiceDay(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function parseSelection(value: string): CottageDiscoverySelection | undefined {
  const fullDay = value.match(fullDayPattern);
  if (fullDay && isServiceDay(fullDay[1])) {
    return { serviceDay: fullDay[1], kind: "full-day" };
  }
  const shift = value.match(selectionPattern);
  if (!shift || !isServiceDay(shift[1])) return undefined;
  return {
    serviceDay: shift[1],
    kind: "shift",
    position: Number(shift[3]) as ShiftPosition,
  };
}

export function parseCottageDiscoveryQuery(
  input: RawQuery,
): CottageDiscoveryQueryResult {
  const from = scalar(input.from);
  const to = scalar(input.to);
  const rawGuests = scalar(input.guests);
  const governorate = scalar(input.governorate)?.trim();
  const area = scalar(input.area)?.trim();
  const rawSelections = repeated(input.selection);
  const amenities = repeated(input.amenity);
  const guests = rawGuests ? Number(rawGuests) : Number.NaN;

  if (
    Object.keys(input).some((key) => !acceptedKeys.has(key)) ||
    !from ||
    !to ||
    !isServiceDay(from) ||
    !isServiceDay(to) ||
    from > to ||
    !Number.isSafeInteger(guests) ||
    guests < 1 ||
    guests > 100 ||
    rawSelections.length === 0 ||
    rawSelections.length > maximumDefensiveSelections ||
    !validFacet(governorate, cottageProfileMaximumLengths.governorate) ||
    !validFacet(area, cottageProfileMaximumLengths.approximateLocation) ||
    amenities.some((amenity) => !knownAmenities.has(amenity)) ||
    new Set(amenities).size !== amenities.length
  ) {
    return { status: "invalid" };
  }

  const selections = rawSelections.map(parseSelection);
  if (selections.some((selection) => selection === undefined)) {
    return { status: "invalid" };
  }
  const parsedSelections = selections as CottageDiscoverySelection[];
  const selectionKeys = parsedSelections.map((selection) =>
    selection.kind === "full-day"
      ? `${selection.serviceDay}:full-day`
      : `${selection.serviceDay}:shift:${selection.position}`,
  );
  if (new Set(selectionKeys).size !== selectionKeys.length) {
    return { status: "invalid" };
  }

  const byDay = new Map<string, CottageDiscoverySelection[]>();
  for (const selection of parsedSelections) {
    const daySelections = byDay.get(selection.serviceDay) ?? [];
    daySelections.push(selection);
    byDay.set(selection.serviceDay, daySelections);
  }
  if (
    byDay.get(from) === undefined ||
    byDay.get(to) === undefined ||
    [...byDay.values()].some(
      (daySelections) =>
        daySelections.some((selection) => selection.kind === "full-day") &&
        daySelections.length !== 1,
    )
  ) {
    return { status: "invalid" };
  }
  const firstDate = new Date(`${from}T00:00:00Z`).valueOf();
  const lastDate = new Date(`${to}T00:00:00Z`).valueOf();
  if ((lastDate - firstDate) / 86_400_000 + 1 > maximumDefensiveServiceDays) {
    return { status: "invalid" };
  }
  for (let day = from; day <= to; day = nextServiceDay(day)) {
    if (!byDay.has(day)) return { status: "invalid" };
  }
  if ([...byDay.keys()].some((day) => day < from || day > to)) {
    return { status: "invalid" };
  }

  parsedSelections.sort((left, right) => {
    const dayOrder = left.serviceDay.localeCompare(right.serviceDay);
    if (dayOrder !== 0) return dayOrder;
    if (left.kind === "full-day") return 1;
    if (right.kind === "full-day") return -1;
    return left.position - right.position;
  });

  return {
    status: "loaded",
    query: {
      from,
      to,
      selections: parsedSelections,
      guests,
      ...(governorate ? { governorate } : {}),
      ...(area ? { area } : {}),
      amenities,
    },
  };
}

export function serializeCottageDiscoveryQuery(
  query: CottageDiscoveryQuery,
): string {
  const params = new URLSearchParams();
  params.set("from", query.from);
  params.set("to", query.to);
  for (const selection of query.selections) {
    params.append(
      "selection",
      selection.kind === "full-day"
        ? `${selection.serviceDay}:full-day`
        : `${selection.serviceDay}:shift:${selection.position}`,
    );
  }
  params.set("guests", String(query.guests));
  if (query.governorate) params.set("governorate", query.governorate);
  if (query.area) params.set("area", query.area);
  for (const amenity of query.amenities) params.append("amenity", amenity);
  return params.toString();
}

export function preserveRawCottageDiscoveryQuery(input: RawQuery): string {
  return new URLSearchParams(
    Object.entries(input).flatMap(([key, value]) =>
      Array.isArray(value)
        ? value.map((item) => [key, item])
        : typeof value === "string"
          ? [[key, value]]
          : [],
    ),
  ).toString();
}
