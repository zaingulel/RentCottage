"use server";

import { revalidatePath } from "next/cache";

import { isLocale, type Locale } from "@/i18n/routing";

import { createRequestCottageInventory } from "./request-cottage-inventory";

export type CottageInventoryActionState = {
  status: "idle" | "saved" | "invalid" | "conflict" | "denied" | "unavailable";
  fields?: string[];
};

export type CottageInventoryAvailabilityLoadActionState =
  | { status: "idle" | "invalid" | "conflict" | "denied" | "unavailable" }
  | {
      status: "loaded";
      serviceDay: string;
      units: Array<{
        id: string;
        kind: "shift" | "full_day_bundle";
        calendarState:
          | "open"
          | "closed"
          | "private_blocked"
          | "pending_hold"
          | "confirmed_booking"
          | "component_unavailable";
        commitmentReference: string | null;
        editable: boolean;
      }>;
    };

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function texts(formData: FormData, name: string): string[] {
  return formData
    .getAll(name)
    .map((value) => (typeof value === "string" ? value : ""));
}

function locale(formData: FormData): Locale | undefined {
  const value = text(formData, "locale");
  return isLocale(value) ? value : undefined;
}

function numberValue(value: string): number {
  return value === "" ? 0 : Number(value);
}

function sameLength(expected: number, ...values: string[][]): boolean {
  return values.every((value) => value.length === expected);
}

function pricing(formData: FormData) {
  const ids = texts(formData, "unitId");
  const kinds = texts(formData, "unitKind");
  const standardPrices = texts(formData, "standardPriceIqd");
  if (!sameLength(ids.length, kinds, standardPrices)) return undefined;
  const units = ids.map((id, index) => ({
    id,
    kind: kinds[index]!,
    standardPriceIqd: numberValue(standardPrices[index]!),
    weekdayOverrides: [] as Array<{ weekday: number; priceIqd: number }>,
    dateOverrides: [] as Array<{ serviceDay: string; priceIqd: number }>,
  }));
  const key = (id: string, kind: string) => `${kind}:${id}`;
  const byKey = new Map(units.map((unit) => [key(unit.id, unit.kind), unit]));
  const weekdayIds = texts(formData, "weekdayUnitId");
  const weekdayKinds = texts(formData, "weekdayUnitKind");
  const weekdays = texts(formData, "weekday");
  const weekdayPrices = texts(formData, "weekdayPriceIqd");
  if (!sameLength(weekdayIds.length, weekdayKinds, weekdays, weekdayPrices)) {
    return undefined;
  }
  for (const [index, id] of weekdayIds.entries()) {
    const weekday = weekdays[index]!;
    const weekdayPrice = weekdayPrices[index]!;
    if (weekday === "" && weekdayPrice === "") continue;
    if (weekday === "" || weekdayPrice === "") return undefined;
    const kind = weekdayKinds[index]!;
    const unit = byKey.get(key(id, kind));
    if (!unit) return undefined;
    unit.weekdayOverrides.push({
      weekday: numberValue(weekday),
      priceIqd: numberValue(weekdayPrice),
    });
  }
  const dateIds = texts(formData, "dateUnitId");
  const dateKinds = texts(formData, "dateUnitKind");
  const serviceDays = texts(formData, "serviceDay");
  const datePrices = texts(formData, "datePriceIqd");
  if (!sameLength(dateIds.length, dateKinds, serviceDays, datePrices)) {
    return undefined;
  }
  for (const [index, id] of dateIds.entries()) {
    const serviceDay = serviceDays[index]!;
    const datePrice = datePrices[index]!;
    if (serviceDay === "" && datePrice === "") continue;
    const kind = dateKinds[index]!;
    const unit = byKey.get(key(id, kind));
    if (!unit) return undefined;
    unit.dateOverrides.push({
      serviceDay,
      priceIqd: numberValue(datePrice),
    });
  }
  return {
    units: units.map((unit) => ({
      id: unit.id,
      kind: unit.kind,
      standardPriceIqd: unit.standardPriceIqd,
      ...(unit.weekdayOverrides.length > 0
        ? { weekdayOverrides: unit.weekdayOverrides }
        : {}),
      ...(unit.dateOverrides.length > 0
        ? { dateOverrides: unit.dateOverrides }
        : {}),
    })),
  };
}

function revalidateOwnerPath(requestedLocale: Locale, profileId: string) {
  revalidatePath(`/${requestedLocale}/owner/cottages/${profileId}`);
}

export async function saveCottageInventoryPricingAction(
  _previous: CottageInventoryActionState,
  formData: FormData,
): Promise<CottageInventoryActionState> {
  const requestedLocale = locale(formData);
  if (!requestedLocale) return { status: "invalid" };
  const profileId = text(formData, "profileId");
  const requestedPricing = pricing(formData);
  if (!requestedPricing) return { status: "invalid" };
  const inventory = await createRequestCottageInventory();
  const result = await inventory.savePricing(
    profileId,
    text(formData, "scheduleRevisionId"),
    requestedPricing,
  );
  if (result.status === "saved") {
    revalidateOwnerPath(requestedLocale, profileId);
    return { status: "saved" };
  }
  return result;
}

export async function loadCottageInventoryAvailabilityAction(
  _previous: CottageInventoryAvailabilityLoadActionState,
  formData: FormData,
): Promise<CottageInventoryAvailabilityLoadActionState> {
  const serviceDay = text(formData, "serviceDay");
  const inventory = await createRequestCottageInventory();
  const result = await inventory.resolveOwnerCalendar(
    text(formData, "profileId"),
    text(formData, "scheduleRevisionId"),
    serviceDay,
  );
  if (result.status !== "resolved") return result;
  if (result.calendar.serviceDay !== serviceDay) {
    return { status: "unavailable" };
  }
  return {
    status: "loaded",
    serviceDay,
    units: result.calendar.units.map((unit) => ({
      id: unit.id,
      kind: unit.kind,
      calendarState: unit.calendarState,
      commitmentReference: unit.commitmentReference,
      editable: unit.editable,
    })),
  };
}

export async function setCottageInventoryAvailabilityAction(
  _previous: CottageInventoryActionState,
  formData: FormData,
): Promise<CottageInventoryActionState> {
  const requestedLocale = locale(formData);
  if (!requestedLocale) return { status: "invalid" };
  const profileId = text(formData, "profileId");
  const ids = texts(formData, "availabilityUnitId");
  const kinds = texts(formData, "availabilityUnitKind");
  const states = texts(formData, "availabilityState");
  if (!sameLength(ids.length, kinds, states)) return { status: "invalid" };
  const inventory = await createRequestCottageInventory();
  const result = await inventory.setAvailability(
    profileId,
    text(formData, "scheduleRevisionId"),
    text(formData, "serviceDay"),
    {
      units: ids.map((id, index) => ({
        id,
        kind: kinds[index]!,
        state: states[index]!,
      })),
    },
  );
  if (result.status === "saved") {
    revalidateOwnerPath(requestedLocale, profileId);
    return { status: "saved" };
  }
  return result;
}
