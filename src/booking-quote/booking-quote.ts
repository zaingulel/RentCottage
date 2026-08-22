import type { Locale } from "@/i18n/routing";
import {
  BOOKING_TERMS_VERSION,
  type BookingTermsFixture,
} from "@/booking-request/booking-terms-fixture";

export { BOOKING_TERMS_VERSION } from "@/booking-request/booking-terms-fixture";

import type { CottageDiscoveryQuery } from "@/cottage-discovery/discovery-query";

export const BOOKING_SERVICE_FEE_IQD = 5_000;
export const MARKETPLACE_COMMISSION_BASIS_POINTS = 1_000;

interface BookingQuoteItemBase {
  serviceDay: string;
  displayName: string;
  startsAt: string;
  endsAt: string;
  crossesMidnight: boolean;
  priceIqd: number;
}

export type BookingQuoteItem = BookingQuoteItemBase &
  (
    | { kind: "shift"; position: 1 | 2 | 3 }
    | { kind: "full-day"; position?: never }
  );

export interface PublicBookingQuote {
  slug: string;
  quoteFingerprint: string;
  cottageName: string;
  contentVersion: number;
  houseRules: string;
  termsVersion: typeof BOOKING_TERMS_VERSION;
  marketplaceTerms: BookingTermsFixture;
  items: BookingQuoteItem[];
  bookingPriceIqd: number;
  serviceFeeIqd: typeof BOOKING_SERVICE_FEE_IQD;
  customerTotalIqd: number;
}

export type PublicBookingQuoteResult =
  | { status: "quoted"; quote: PublicBookingQuote }
  | { status: "selection-unavailable" }
  | { status: "not-found" }
  | { status: "unavailable" };

export interface BookingQuotePort {
  load(
    locale: Locale,
    publicSlug: string,
    discoveryQuery: CottageDiscoveryQuery,
  ): Promise<PublicBookingQuoteResult>;
}

const localTimestampPattern =
  /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d:00\+03:00$/;

const publicCottageSlugPattern = /^cottage-[0-9a-f]{32}$/;

export function isPublicCottageSlug(value: string): boolean {
  return publicCottageSlugPattern.test(value);
}

export function isBookingQuoteFingerprint(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function nextServiceDay(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function isServiceDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
}

export function bookingQuoteTotals(pricesIqd: number[]) {
  if (
    pricesIqd.length === 0 ||
    pricesIqd.some((price) => !Number.isSafeInteger(price) || price <= 0)
  ) {
    throw new Error("Booking Quote prices must be positive safe whole IQD");
  }
  const bookingPriceIqd = pricesIqd.reduce((total, price) => total + price, 0);
  const customerTotalIqd = bookingPriceIqd + BOOKING_SERVICE_FEE_IQD;
  const commissionAmountFils = bookingPriceIqd * 100;
  if (
    !Number.isSafeInteger(bookingPriceIqd) ||
    !Number.isSafeInteger(customerTotalIqd) ||
    !Number.isSafeInteger(commissionAmountFils)
  ) {
    throw new Error("Booking Quote money must remain safe whole IQD");
  }
  return {
    bookingPriceIqd,
    serviceFeeIqd: BOOKING_SERVICE_FEE_IQD,
    customerTotalIqd,
    commissionRateBasisPoints: MARKETPLACE_COMMISSION_BASIS_POINTS,
    commissionAmountFils,
  } as const;
}

export function validateQuotedItems(items: BookingQuoteItem[]): boolean {
  if (items.length === 0 || items.length > 1_200) return false;
  const identities = new Set<string>();
  for (const item of items) {
    const start = item.startsAt.match(localTimestampPattern);
    const end = item.endsAt.match(localTimestampPattern);
    const identity = `${item.serviceDay}:${item.kind}:${item.position ?? "full"}`;
    if (
      !start ||
      !end ||
      !isServiceDay(item.serviceDay) ||
      start[1] !== item.serviceDay ||
      end[1] < start[1] ||
      end[1] > nextServiceDay(item.serviceDay) ||
      item.crossesMidnight !== end[1] > item.serviceDay ||
      item.startsAt >= item.endsAt ||
      !item.displayName.trim() ||
      !Number.isSafeInteger(item.priceIqd) ||
      item.priceIqd <= 0 ||
      (item.kind === "shift"
        ? ![1, 2, 3].includes(item.position ?? 0)
        : item.position !== undefined) ||
      identities.has(identity)
    ) {
      return false;
    }
    identities.add(identity);
  }
  return true;
}

export function continuousFullDayAccess(items: BookingQuoteItem[]) {
  const bundles = items
    .filter((item) => item.kind === "full-day")
    .sort((left, right) => left.serviceDay.localeCompare(right.serviceDay));
  const ranges: Array<{
    fromServiceDay: string;
    toServiceDay: string;
    startsAt: string;
    endsAt: string;
  }> = [];
  for (const bundle of bundles) {
    const previous = ranges.at(-1);
    if (
      previous &&
      nextServiceDay(previous.toServiceDay) === bundle.serviceDay
    ) {
      previous.toServiceDay = bundle.serviceDay;
      previous.endsAt = bundle.endsAt;
    } else {
      ranges.push({
        fromServiceDay: bundle.serviceDay,
        toServiceDay: bundle.serviceDay,
        startsAt: bundle.startsAt,
        endsAt: bundle.endsAt,
      });
    }
  }
  return ranges;
}
