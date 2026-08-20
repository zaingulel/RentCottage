import type { SupabaseClient } from "@supabase/supabase-js";

import type { CottageDiscoveryQuery } from "@/cottage-discovery/discovery-query";
import type { Locale } from "@/i18n/routing";

import {
  BOOKING_SERVICE_FEE_IQD,
  BOOKING_TERMS_VERSION,
  bookingQuoteTotals,
  isPublicCottageSlug,
  type BookingQuoteItem,
  type BookingQuotePort,
  type PublicBookingQuoteResult,
  validateQuotedItems,
} from "./booking-quote";

const quoteKeys = new Set([
  "status",
  "slug",
  "cottageName",
  "contentVersion",
  "houseRules",
  "termsVersion",
  "items",
  "bookingPriceIqd",
  "serviceFeeIqd",
  "customerTotalIqd",
]);
const stateKeys = new Set(["status"]);
const shiftItemKeys = new Set([
  "serviceDay",
  "kind",
  "position",
  "displayName",
  "startsAt",
  "endsAt",
  "crossesMidnight",
  "priceIqd",
]);
const fullDayItemKeys = new Set(
  [...shiftItemKeys].filter((key) => key !== "position"),
);

function exactObject(
  value: unknown,
  keys: Set<string>,
): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.size && actual.every((key) => keys.has(key));
}

function itemFrom(value: unknown): BookingQuoteItem | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const item = value as Record<string, unknown>;
  if (
    (item.kind === "shift" && !exactObject(item, shiftItemKeys)) ||
    (item.kind === "full-day" && !exactObject(item, fullDayItemKeys)) ||
    (item.kind !== "shift" && item.kind !== "full-day") ||
    typeof item.serviceDay !== "string" ||
    typeof item.displayName !== "string" ||
    typeof item.startsAt !== "string" ||
    typeof item.endsAt !== "string" ||
    typeof item.crossesMidnight !== "boolean" ||
    !Number.isSafeInteger(item.priceIqd) ||
    (item.kind === "shift" && ![1, 2, 3].includes(item.position as number))
  ) {
    return undefined;
  }
  return item as unknown as BookingQuoteItem;
}

function itemIdentity(item: BookingQuoteItem) {
  return `${item.serviceDay}:${item.kind}:${item.position ?? "full"}`;
}

function requestedIdentity(
  selection: CottageDiscoveryQuery["selections"][number],
) {
  return `${selection.serviceDay}:${selection.kind}:${selection.kind === "shift" ? selection.position : "full"}`;
}

function unavailable(reason: "provider-error" | "invalid-provider-data") {
  console.error("Public Booking Quote unavailable", { reason });
  return { status: "unavailable" } as const;
}

export class SupabaseBookingQuote implements BookingQuotePort {
  constructor(private readonly client: SupabaseClient) {}

  async load(
    locale: Locale,
    publicSlug: string,
    discoveryQuery: CottageDiscoveryQuery,
  ): Promise<PublicBookingQuoteResult> {
    if (!isPublicCottageSlug(publicSlug)) return { status: "not-found" };
    const { data, error } = await this.client.rpc("get_public_booking_quote", {
      target_locale: locale,
      target_slug: publicSlug,
      requested_search: discoveryQuery,
    });
    if (error) return unavailable("provider-error");
    if (exactObject(data, stateKeys)) {
      return data.status === "not-found" ||
        data.status === "selection-unavailable"
        ? { status: data.status }
        : unavailable("invalid-provider-data");
    }
    if (!exactObject(data, quoteKeys) || data.status !== "quoted") {
      return unavailable("invalid-provider-data");
    }
    if (!Array.isArray(data.items)) return unavailable("invalid-provider-data");
    const items = data.items.map(itemFrom);
    if (items.some((item) => item === undefined)) {
      return unavailable("invalid-provider-data");
    }
    const quotedItems = items as BookingQuoteItem[];
    let totals;
    try {
      totals = bookingQuoteTotals(quotedItems.map((item) => item.priceIqd));
    } catch {
      return unavailable("invalid-provider-data");
    }
    const requested = discoveryQuery.selections.map(requestedIdentity);
    const returned = quotedItems.map(itemIdentity);
    if (
      typeof data.slug !== "string" ||
      data.slug !== publicSlug ||
      !isPublicCottageSlug(data.slug) ||
      typeof data.cottageName !== "string" ||
      !data.cottageName.trim() ||
      !Number.isSafeInteger(data.contentVersion) ||
      (data.contentVersion as number) < 1 ||
      typeof data.houseRules !== "string" ||
      !data.houseRules.trim() ||
      data.termsVersion !== BOOKING_TERMS_VERSION ||
      !validateQuotedItems(quotedItems) ||
      returned.length !== requested.length ||
      returned.some((identity, index) => identity !== requested[index]) ||
      data.bookingPriceIqd !== totals.bookingPriceIqd ||
      data.serviceFeeIqd !== BOOKING_SERVICE_FEE_IQD ||
      data.customerTotalIqd !== totals.customerTotalIqd
    ) {
      return unavailable("invalid-provider-data");
    }
    return {
      status: "quoted",
      quote: {
        slug: data.slug,
        cottageName: data.cottageName,
        contentVersion: data.contentVersion as number,
        houseRules: data.houseRules,
        termsVersion: BOOKING_TERMS_VERSION,
        items: quotedItems,
        bookingPriceIqd: totals.bookingPriceIqd,
        serviceFeeIqd: totals.serviceFeeIqd,
        customerTotalIqd: totals.customerTotalIqd,
      },
    };
  }
}
