import type { SupabaseClient } from "@supabase/supabase-js";

import { cottageProfileAmenities } from "@/cottage-profile/cottage-profile";
import type { Locale } from "@/i18n/routing";

import type { CottageDiscoveryQuery } from "./discovery-query";

export interface PublicCottageSummary {
  slug: string;
  name: string;
  governorate: string;
  approximateLocation: string;
  capacity: number;
  amenities: string[];
  mediaUrls: string[];
  inventory: PublicCottageInventoryUnit[];
}

export interface PublicCottageInventoryUnit {
  serviceDay: string;
  kind: "shift" | "full-day";
  position?: number;
  name: string;
  startTime: string;
  endTime: string;
  priceIqd: number | null;
  available: boolean;
}

export interface PublicCottageProfile extends PublicCottageSummary {
  bedrooms: number;
  bathrooms: number;
  description: string;
  houseRules: string;
}

export type CottageDiscoveryResult =
  | { status: "loaded"; cottages: PublicCottageSummary[] }
  | { status: "unavailable" };

export type CottageDiscoveryProfileResult =
  | { status: "loaded"; cottage: PublicCottageProfile }
  | { status: "not-found" }
  | { status: "unavailable" };

export type CottageDiscoveryFacetsResult =
  | {
      status: "loaded";
      governorates: string[];
      areas: string[];
      amenities: string[];
    }
  | { status: "unavailable" };

export type CottageDiscoveryDefaultQueryResult =
  | { status: "loaded"; query: CottageDiscoveryQuery }
  | { status: "not-found" }
  | { status: "unavailable" };

const summaryKeys = new Set([
  "slug",
  "name",
  "governorate",
  "approximateLocation",
  "capacity",
  "amenities",
  "mediaIds",
  "inventory",
]);
const profileKeys = new Set([
  ...summaryKeys,
  "bedrooms",
  "bathrooms",
  "description",
  "houseRules",
]);
const inventoryShiftKeys = new Set([
  "serviceDay",
  "kind",
  "position",
  "name",
  "startTime",
  "endTime",
  "priceIqd",
  "available",
]);
const inventoryFullDayKeys = new Set(
  [...inventoryShiftKeys].filter((key) => key !== "position"),
);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const publicSlugPattern = /^cottage-[0-9a-f]{32}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const serviceDayPattern = /^\d{4}-\d{2}-\d{2}$/;
const knownAmenities = new Set<string>(cottageProfileAmenities);

function exactObject(value: unknown, keys: Set<string>) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const inputKeys = Object.keys(value);
  return (
    inputKeys.length === keys.size && inputKeys.every((key) => keys.has(key))
  );
}

function stringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    new Set(value).size === value.length &&
    value.every((item) => typeof item === "string" && item.trim().length > 0)
  );
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function serviceDay(value: unknown): value is string {
  if (typeof value !== "string" || !serviceDayPattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function amenityArray(value: unknown): value is string[] {
  return stringArray(value) && value.every((item) => knownAmenities.has(item));
}

function unavailable(
  operation: "search" | "facets" | "default-query" | "profile",
  result: "provider-error" | "invalid-provider-data",
): { status: "unavailable" } {
  console.error("Public Cottage discovery unavailable", { operation, result });
  return { status: "unavailable" };
}

function inventoryIdentity(
  item:
    | CottageDiscoveryQuery["selections"][number]
    | PublicCottageInventoryUnit,
) {
  return `${item.serviceDay}:${item.kind}:${item.kind === "shift" ? item.position : "full"}`;
}

function inventoryFrom(
  value: unknown,
  query: CottageDiscoveryQuery,
): PublicCottageInventoryUnit[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 1600)
    return undefined;
  const byDay = new Map<string, PublicCottageInventoryUnit[]>();
  let previousKey = "";
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    const item = raw as Record<string, unknown>;
    if (
      (item.kind !== "shift" && item.kind !== "full-day") ||
      !exactObject(
        item,
        item.kind === "shift" ? inventoryShiftKeys : inventoryFullDayKeys,
      ) ||
      !serviceDay(item.serviceDay) ||
      item.serviceDay < query.from ||
      item.serviceDay > query.to ||
      !nonEmptyText(item.name) ||
      typeof item.startTime !== "string" ||
      !timePattern.test(item.startTime) ||
      typeof item.endTime !== "string" ||
      !timePattern.test(item.endTime) ||
      !(
        item.priceIqd === null ||
        (Number.isSafeInteger(item.priceIqd) && (item.priceIqd as number) > 0)
      ) ||
      typeof item.available !== "boolean" ||
      (item.available && item.priceIqd === null) ||
      (item.kind === "shift" && ![1, 2, 3].includes(item.position as number))
    )
      return undefined;
    const key = `${item.serviceDay}:${item.kind === "shift" ? item.position : 4}`;
    if (key <= previousKey) return undefined;
    previousKey = key;
    const units = byDay.get(item.serviceDay) ?? [];
    units.push(item as unknown as PublicCottageInventoryUnit);
    byDay.set(item.serviceDay, units);
  }
  for (let day = query.from; day <= query.to; ) {
    const units = byDay.get(day);
    if (
      !units ||
      (units.length !== 3 && units.length !== 4) ||
      units.at(-1)?.kind !== "full-day" ||
      units
        .slice(0, -1)
        .some(
          (unit, index) => unit.kind !== "shift" || unit.position !== index + 1,
        )
    )
      return undefined;
    const next = new Date(`${day}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    day = next.toISOString().slice(0, 10);
  }
  return value as PublicCottageInventoryUnit[];
}

function inventorySatisfiesSearch(
  inventory: PublicCottageInventoryUnit[],
  query: CottageDiscoveryQuery,
) {
  const availableDays = new Set(
    inventory.filter((item) => item.available).map((item) => item.serviceDay),
  );
  const offeredDays = new Set(inventory.map((item) => item.serviceDay));
  const availableUnits = new Set(
    inventory.filter((item) => item.available).map(inventoryIdentity),
  );
  return (
    availableDays.size === offeredDays.size &&
    query.selections.every((selection) =>
      availableUnits.has(inventoryIdentity(selection)),
    )
  );
}

function summaryFrom(
  value: unknown,
  query: CottageDiscoveryQuery,
): PublicCottageSummary | undefined {
  if (!exactObject(value, summaryKeys)) return undefined;
  const input = value as Record<string, unknown>;
  const inventory = inventoryFrom(input.inventory, query);
  if (
    typeof input.slug !== "string" ||
    !publicSlugPattern.test(input.slug) ||
    !nonEmptyText(input.name) ||
    !nonEmptyText(input.governorate) ||
    !nonEmptyText(input.approximateLocation) ||
    !Number.isSafeInteger(input.capacity) ||
    (input.capacity as number) < 1 ||
    !amenityArray(input.amenities) ||
    !stringArray(input.mediaIds) ||
    !input.mediaIds.every((id) => uuidPattern.test(id)) ||
    !inventory ||
    !inventorySatisfiesSearch(inventory, query)
  ) {
    return undefined;
  }
  return {
    slug: input.slug,
    name: input.name,
    governorate: input.governorate,
    approximateLocation: input.approximateLocation,
    capacity: input.capacity as number,
    amenities: input.amenities,
    mediaUrls: input.mediaIds.map((id) => `/api/cottage-media/${id}`),
    inventory,
  };
}

function profileFrom(
  value: unknown,
  query: CottageDiscoveryQuery,
): PublicCottageProfile | undefined {
  if (!exactObject(value, profileKeys)) return undefined;
  const input = value as Record<string, unknown>;
  const inventory = inventoryFrom(input.inventory, query);
  if (
    typeof input.slug !== "string" ||
    !publicSlugPattern.test(input.slug) ||
    !nonEmptyText(input.name) ||
    !nonEmptyText(input.governorate) ||
    !nonEmptyText(input.approximateLocation) ||
    !Number.isSafeInteger(input.capacity) ||
    !amenityArray(input.amenities) ||
    !stringArray(input.mediaIds) ||
    !input.mediaIds.every((id) => uuidPattern.test(id)) ||
    (input.capacity as number) < 1 ||
    !inventory ||
    !Number.isSafeInteger(input.bedrooms) ||
    !Number.isSafeInteger(input.bathrooms) ||
    (input.bedrooms as number) < 0 ||
    (input.bathrooms as number) < 0 ||
    !nonEmptyText(input.description) ||
    !nonEmptyText(input.houseRules)
  ) {
    return undefined;
  }
  return {
    slug: input.slug,
    name: input.name,
    governorate: input.governorate,
    approximateLocation: input.approximateLocation,
    capacity: input.capacity as number,
    amenities: input.amenities,
    mediaUrls: input.mediaIds.map((id) => `/api/cottage-media/${id}`),
    inventory,
    bedrooms: input.bedrooms as number,
    bathrooms: input.bathrooms as number,
    description: input.description,
    houseRules: input.houseRules,
  };
}

function defaultQueryFrom(value: unknown): CottageDiscoveryQuery | undefined {
  const keys = new Set(["from", "to", "selections", "guests", "amenities"]);
  if (!exactObject(value, keys)) return undefined;
  const input = value as Record<string, unknown>;
  if (
    !serviceDay(input.from) ||
    !serviceDay(input.to) ||
    !Number.isSafeInteger(input.guests) ||
    (input.guests as number) < 1 ||
    (input.guests as number) > 100 ||
    !Array.isArray(input.amenities) ||
    input.amenities.length !== 0 ||
    !Array.isArray(input.selections) ||
    input.selections.length < 1 ||
    input.selections.length > 3
  )
    return undefined;
  if (input.from !== input.to) return undefined;
  const selections = input.selections.map((selection) => {
    if (!selection || typeof selection !== "object" || Array.isArray(selection))
      return undefined;
    const item = selection as Record<string, unknown>;
    if (
      !exactObject(item, new Set(["serviceDay", "kind", "position"])) ||
      item.serviceDay !== input.from ||
      item.kind !== "shift" ||
      !Number.isSafeInteger(item.position) ||
      (item.position as number) < 1 ||
      (item.position as number) > 3
    )
      return undefined;
    return {
      serviceDay: input.from as string,
      kind: "shift" as const,
      position: item.position as 1 | 2 | 3,
    };
  });
  if (
    selections.some((selection) => selection === undefined) ||
    new Set(selections.map((selection) => selection?.position)).size !==
      selections.length
  )
    return undefined;
  return {
    from: input.from,
    to: input.to,
    guests: input.guests as number,
    amenities: [],
    selections: selections as CottageDiscoveryQuery["selections"],
  };
}

export class SupabaseCottageDiscovery {
  constructor(private readonly client: SupabaseClient) {}

  async search(
    locale: Locale,
    query: CottageDiscoveryQuery,
  ): Promise<CottageDiscoveryResult> {
    const { data, error } = await this.client.rpc("search_public_cottages", {
      target_locale: locale,
      requested_search: query,
    });
    if (error) return unavailable("search", "provider-error");
    if (!Array.isArray(data))
      return unavailable("search", "invalid-provider-data");
    const cottages = data.map((cottage) => summaryFrom(cottage, query));
    if (
      cottages.some((cottage) => cottage === undefined) ||
      new Set(cottages.map((cottage) => cottage?.slug)).size !== cottages.length
    ) {
      return unavailable("search", "invalid-provider-data");
    }
    return {
      status: "loaded",
      cottages: cottages as PublicCottageSummary[],
    };
  }

  async facets(locale: Locale): Promise<CottageDiscoveryFacetsResult> {
    const { data, error } = await this.client.rpc("get_public_cottage_facets", {
      target_locale: locale,
    });
    if (
      error ||
      !exactObject(data, new Set(["governorates", "areas", "amenities"]))
    ) {
      return unavailable(
        "facets",
        error ? "provider-error" : "invalid-provider-data",
      );
    }
    const input = data as Record<string, unknown>;
    if (
      !stringArray(input.governorates) ||
      !stringArray(input.areas) ||
      !amenityArray(input.amenities)
    ) {
      return unavailable("facets", "invalid-provider-data");
    }
    return {
      status: "loaded",
      governorates: input.governorates,
      areas: input.areas,
      amenities: input.amenities,
    };
  }

  async defaultQuery(
    slug: string,
  ): Promise<CottageDiscoveryDefaultQueryResult> {
    const { data, error } = await this.client.rpc(
      "get_default_public_cottage_search",
      {
        target_slug: slug,
      },
    );
    if (error) return unavailable("default-query", "provider-error");
    if (data === null) return { status: "not-found" };
    const query = defaultQueryFrom(data);
    return query
      ? { status: "loaded", query }
      : unavailable("default-query", "invalid-provider-data");
  }

  async profile(
    locale: Locale,
    slug: string,
    query: CottageDiscoveryQuery,
  ): Promise<CottageDiscoveryProfileResult> {
    const { data, error } = await this.client.rpc(
      "get_public_cottage_profile",
      {
        target_locale: locale,
        target_slug: slug,
        requested_search: query,
      },
    );
    if (error) return unavailable("profile", "provider-error");
    if (data === null) return { status: "not-found" };
    const cottage = profileFrom(data, query);
    return cottage
      ? { status: "loaded", cottage }
      : unavailable("profile", "invalid-provider-data");
  }
}
