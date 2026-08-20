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
  totalPriceIqd: number;
  selectedInventory: PublicCottageSelectedInventory[];
}

export interface PublicCottageSelectedInventory {
  serviceDay: string;
  kind: "shift" | "full-day";
  position?: number;
  name: string;
  startTime: string;
  endTime: string;
  priceIqd: number | null;
  available: boolean;
}

export interface PublicCottageProfile extends Omit<
  PublicCottageSummary,
  "totalPriceIqd" | "selectedInventory"
> {
  totalPriceIqd: number | null;
  selectedInventory: PublicCottageSelectedInventory[];
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
  "totalPriceIqd",
  "selectedInventory",
]);
const profileKeys = new Set([
  ...summaryKeys,
  "bedrooms",
  "bathrooms",
  "description",
  "houseRules",
]);
const selectedShiftKeys = new Set([
  "serviceDay",
  "kind",
  "position",
  "name",
  "startTime",
  "endTime",
  "priceIqd",
  "available",
]);
const selectedFullDayKeys = new Set(
  [...selectedShiftKeys].filter((key) => key !== "position"),
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

function selectedInventoryFrom(
  value: unknown,
  availableOnly: boolean,
): PublicCottageSelectedInventory[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 1200)
    return undefined;
  if (
    !value.every((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item))
        return false;
      const selected = item as Record<string, unknown>;
      const kind = selected.kind;
      if (
        (kind === "shift" && !exactObject(selected, selectedShiftKeys)) ||
        (kind === "full-day" && !exactObject(selected, selectedFullDayKeys))
      )
        return false;
      const validPrice =
        selected.priceIqd === null ||
        (Number.isSafeInteger(selected.priceIqd) &&
          (selected.priceIqd as number) > 0);
      return (
        serviceDay(selected.serviceDay) &&
        nonEmptyText(selected.name) &&
        typeof selected.startTime === "string" &&
        timePattern.test(selected.startTime) &&
        typeof selected.endTime === "string" &&
        timePattern.test(selected.endTime) &&
        validPrice &&
        typeof selected.available === "boolean" &&
        (!availableOnly ||
          (selected.available === true && selected.priceIqd !== null)) &&
        (kind === "full-day" ||
          (Number.isSafeInteger(selected.position) &&
            (selected.position as number) >= 1 &&
            (selected.position as number) <= 3))
      );
    })
  )
    return undefined;
  const keys = value.map((item) => {
    const selected = item as Record<string, unknown>;
    return `${selected.serviceDay}:${selected.kind}:${selected.position ?? "full"}`;
  });
  if (new Set(keys).size !== keys.length) return undefined;
  const byDay = new Map<string, number>();
  for (const item of value as Array<Record<string, unknown>>) {
    const day = item.serviceDay as string;
    if (item.kind === "full-day" && byDay.has(day)) return undefined;
    if (item.kind !== "full-day" && byDay.get(day) === -1) return undefined;
    byDay.set(day, item.kind === "full-day" ? -1 : (byDay.get(day) ?? 0) + 1);
  }
  return value as PublicCottageSelectedInventory[];
}

function selectedInventoryMatchesQuery(
  inventory: PublicCottageSelectedInventory[],
  query: CottageDiscoveryQuery,
) {
  const inventoryKeys = inventory.map(
    (item) =>
      `${item.serviceDay}:${item.kind}:${item.kind === "shift" ? item.position : "full"}`,
  );
  const queryKeys = query.selections.map(
    (item) =>
      `${item.serviceDay}:${item.kind}:${item.kind === "shift" ? item.position : "full"}`,
  );
  return (
    inventoryKeys.length === queryKeys.length &&
    inventoryKeys.every((key, index) => key === queryKeys[index])
  );
}

function selectedInventoryTotal(
  inventory: PublicCottageSelectedInventory[],
): number | null | undefined {
  if (inventory.some((item) => item.priceIqd === null)) return null;
  const total = inventory.reduce((sum, item) => sum + (item.priceIqd ?? 0), 0);
  return Number.isSafeInteger(total) ? total : undefined;
}

function summaryFrom(
  value: unknown,
  query: CottageDiscoveryQuery,
): PublicCottageSummary | undefined {
  if (!exactObject(value, summaryKeys)) return undefined;
  const input = value as Record<string, unknown>;
  const selectedInventory = selectedInventoryFrom(
    input.selectedInventory,
    true,
  );
  if (
    typeof input.slug !== "string" ||
    !publicSlugPattern.test(input.slug) ||
    !nonEmptyText(input.name) ||
    !nonEmptyText(input.governorate) ||
    !nonEmptyText(input.approximateLocation) ||
    !Number.isSafeInteger(input.capacity) ||
    !Number.isSafeInteger(input.totalPriceIqd) ||
    (input.capacity as number) < 1 ||
    (input.totalPriceIqd as number) < 1 ||
    !amenityArray(input.amenities) ||
    !stringArray(input.mediaIds) ||
    !input.mediaIds.every((id) => uuidPattern.test(id)) ||
    !selectedInventory ||
    !selectedInventoryMatchesQuery(selectedInventory, query) ||
    selectedInventoryTotal(selectedInventory) !== input.totalPriceIqd
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
    totalPriceIqd: input.totalPriceIqd as number,
    selectedInventory,
  };
}

function profileFrom(
  value: unknown,
  query: CottageDiscoveryQuery,
): PublicCottageProfile | undefined {
  if (!exactObject(value, profileKeys)) return undefined;
  const input = value as Record<string, unknown>;
  const selectedInventory = selectedInventoryFrom(
    input.selectedInventory,
    false,
  );
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
    !(
      input.totalPriceIqd === null ||
      (Number.isSafeInteger(input.totalPriceIqd) &&
        (input.totalPriceIqd as number) > 0)
    ) ||
    !selectedInventory ||
    !selectedInventoryMatchesQuery(selectedInventory, query) ||
    selectedInventoryTotal(selectedInventory) !== input.totalPriceIqd ||
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
    totalPriceIqd: input.totalPriceIqd as number | null,
    selectedInventory,
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
    if (cottages.some((cottage) => cottage === undefined)) {
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
