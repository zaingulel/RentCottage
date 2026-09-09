import type { SupabaseClient } from "@supabase/supabase-js";

import {
  validateQuotedItems,
  type BookingQuoteItem,
} from "@/booking-quote/booking-quote";
import { isContactSafeBookingRequestText } from "./booking-request-content";

const requestReferencePattern = /^RC-REQ-[A-F0-9]{16}$/;
const bookingReferencePattern = /^[A-Z0-9][A-Z0-9-]{0,119}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const phonePattern = /^\+[1-9][0-9]{7,14}$/;

const sharedKeys = new Set([
  "receiptId",
  "bookingRequestReference",
  "bookingReference",
  "confirmedAt",
  "actorRole",
  "customerName",
  "cottageName",
  "bookingPeriod",
  "partySize",
  "pricing",
  "houseRules",
  "bookingTermsVersion",
  "cancellationPolicyVersion",
  "exactAddress",
  "privateDirections",
  "mapPin",
  "customerPhone",
  "ownerPhone",
]);

interface ConfirmedBookingAccessBase {
  readonly receiptId: string;
  readonly bookingRequestReference: string;
  readonly bookingReference: string;
  readonly confirmedAt: string;
  readonly customerName: string;
  readonly cottageName: string;
  readonly bookingPeriod: readonly BookingQuoteItem[];
  readonly partySize: number;
  readonly houseRules: string;
  readonly bookingTermsVersion: string;
  readonly cancellationPolicyVersion: string;
  readonly exactAddress: string | null;
  readonly privateDirections: string | null;
  readonly mapPin: {
    readonly latitude: number;
    readonly longitude: number;
  } | null;
  readonly customerPhone: string | null;
  readonly ownerPhone: string | null;
}

export interface CustomerConfirmedBookingAccess extends ConfirmedBookingAccessBase {
  readonly actorRole: "customer";
  readonly pricing: {
    readonly bookingPriceIqd: number;
    readonly serviceFeeIqd: number;
    readonly customerTotalIqd: number;
  };
}

export interface OwnerConfirmedBookingAccess extends ConfirmedBookingAccessBase {
  readonly actorRole: "cottage_owner";
  readonly pricing: {
    readonly bookingPriceIqd: number;
    readonly marketplaceCommissionFils: number;
    readonly ownerNetFils: number;
  };
}

export type ConfirmedBookingAccess =
  | CustomerConfirmedBookingAccess
  | OwnerConfirmedBookingAccess;

function isOptionalNonEmptyText(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" && value.length > 0 && value === value.trim())
  );
}

function isOptionalVerifiedPhone(value: unknown): value is string | null {
  return (
    value === null || (typeof value === "string" && phonePattern.test(value))
  );
}

function isMapPin(
  value: unknown,
): value is ConfirmedBookingAccessBase["mapPin"] {
  if (value === null) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const pin = value as Record<string, unknown>;
  return (
    Object.keys(pin).length === 2 &&
    Object.hasOwn(pin, "latitude") &&
    Object.hasOwn(pin, "longitude") &&
    typeof pin.latitude === "number" &&
    Number.isFinite(pin.latitude) &&
    pin.latitude >= -90 &&
    pin.latitude <= 90 &&
    typeof pin.longitude === "number" &&
    Number.isFinite(pin.longitude) &&
    pin.longitude >= -180 &&
    pin.longitude <= 180
  );
}

function isCustomerPricing(
  value: unknown,
): value is CustomerConfirmedBookingAccess["pricing"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const pricing = value as Record<string, unknown>;
  return (
    Object.keys(pricing).length === 3 &&
    Object.hasOwn(pricing, "bookingPriceIqd") &&
    Object.hasOwn(pricing, "serviceFeeIqd") &&
    Object.hasOwn(pricing, "customerTotalIqd") &&
    Number.isSafeInteger(pricing.bookingPriceIqd) &&
    (pricing.bookingPriceIqd as number) > 0 &&
    Number.isSafeInteger(pricing.serviceFeeIqd) &&
    (pricing.serviceFeeIqd as number) >= 0 &&
    Number.isSafeInteger(pricing.customerTotalIqd) &&
    Number.isSafeInteger(
      (pricing.bookingPriceIqd as number) + (pricing.serviceFeeIqd as number),
    ) &&
    pricing.customerTotalIqd ===
      (pricing.bookingPriceIqd as number) + (pricing.serviceFeeIqd as number)
  );
}

function isOwnerPricing(
  value: unknown,
): value is OwnerConfirmedBookingAccess["pricing"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const pricing = value as Record<string, unknown>;
  return (
    Object.keys(pricing).length === 3 &&
    Object.hasOwn(pricing, "bookingPriceIqd") &&
    Object.hasOwn(pricing, "marketplaceCommissionFils") &&
    Object.hasOwn(pricing, "ownerNetFils") &&
    Number.isSafeInteger(pricing.bookingPriceIqd) &&
    (pricing.bookingPriceIqd as number) > 0 &&
    Number.isSafeInteger(pricing.marketplaceCommissionFils) &&
    (pricing.marketplaceCommissionFils as number) > 0 &&
    Number.isSafeInteger(pricing.ownerNetFils) &&
    (pricing.ownerNetFils as number) > 0 &&
    Number.isSafeInteger((pricing.bookingPriceIqd as number) * 1000) &&
    (pricing.marketplaceCommissionFils as number) +
      (pricing.ownerNetFils as number) ===
      (pricing.bookingPriceIqd as number) * 1000
  );
}

function cloneBookingPeriod(
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

function confirmedBookingAccessFrom(
  value: unknown,
): ConfirmedBookingAccess | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const access = value as Record<string, unknown>;
  const actualKeys = Object.keys(access);
  if (
    actualKeys.length !== sharedKeys.size ||
    actualKeys.some((key) => !sharedKeys.has(key)) ||
    typeof access.receiptId !== "string" ||
    !uuidPattern.test(access.receiptId) ||
    typeof access.bookingRequestReference !== "string" ||
    !requestReferencePattern.test(access.bookingRequestReference) ||
    typeof access.bookingReference !== "string" ||
    !bookingReferencePattern.test(access.bookingReference) ||
    typeof access.confirmedAt !== "string" ||
    Number.isNaN(Date.parse(access.confirmedAt)) ||
    (access.actorRole !== "customer" && access.actorRole !== "cottage_owner") ||
    typeof access.customerName !== "string" ||
    access.customerName.length < 2 ||
    access.customerName.length > 120 ||
    access.customerName !== access.customerName.trim() ||
    !isContactSafeBookingRequestText(access.customerName) ||
    typeof access.cottageName !== "string" ||
    !access.cottageName.trim() ||
    !Array.isArray(access.bookingPeriod) ||
    !validateQuotedItems(access.bookingPeriod as BookingQuoteItem[]) ||
    !Number.isSafeInteger(access.partySize) ||
    (access.partySize as number) < 1 ||
    typeof access.houseRules !== "string" ||
    !access.houseRules.trim() ||
    typeof access.bookingTermsVersion !== "string" ||
    !access.bookingTermsVersion.trim() ||
    typeof access.cancellationPolicyVersion !== "string" ||
    !access.cancellationPolicyVersion.trim() ||
    !isOptionalNonEmptyText(access.exactAddress) ||
    !isOptionalNonEmptyText(access.privateDirections) ||
    !isMapPin(access.mapPin) ||
    !isOptionalVerifiedPhone(access.customerPhone) ||
    !isOptionalVerifiedPhone(access.ownerPhone) ||
    (access.actorRole === "customer"
      ? !isCustomerPricing(access.pricing)
      : !isOwnerPricing(access.pricing))
  ) {
    return;
  }

  const base = {
    receiptId: access.receiptId,
    bookingRequestReference: access.bookingRequestReference,
    bookingReference: access.bookingReference,
    confirmedAt: access.confirmedAt,
    customerName: access.customerName,
    cottageName: access.cottageName,
    bookingPeriod: cloneBookingPeriod(
      access.bookingPeriod as readonly BookingQuoteItem[],
    ),
    partySize: access.partySize as number,
    houseRules: access.houseRules,
    bookingTermsVersion: access.bookingTermsVersion,
    cancellationPolicyVersion: access.cancellationPolicyVersion,
    exactAddress: access.exactAddress,
    privateDirections: access.privateDirections,
    mapPin:
      access.mapPin === null
        ? null
        : {
            latitude: access.mapPin.latitude,
            longitude: access.mapPin.longitude,
          },
    customerPhone: access.customerPhone,
    ownerPhone: access.ownerPhone,
  };
  return access.actorRole === "customer"
    ? {
        ...base,
        actorRole: "customer",
        pricing: {
          ...(access.pricing as CustomerConfirmedBookingAccess["pricing"]),
        },
      }
    : {
        ...base,
        actorRole: "cottage_owner",
        pricing: {
          ...(access.pricing as OwnerConfirmedBookingAccess["pricing"]),
        },
      };
}

export async function getConfirmedBookingAccess(
  client: SupabaseClient,
  reference: string,
): Promise<ConfirmedBookingAccess | null> {
  if (!requestReferencePattern.test(reference)) return null;
  const { data, error } = await client.rpc("get_confirmed_booking_access", {
    target_reference: reference,
  });
  if (error) throw new Error("Confirmed Booking access is unavailable");
  if (data === null) return null;
  const access = confirmedBookingAccessFrom(data);
  if (!access) throw new Error("Confirmed Booking access data is invalid");
  return access;
}
