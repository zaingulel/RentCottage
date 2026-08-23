import type { SupabaseClient } from "@supabase/supabase-js";

import {
  validateQuotedItems,
  type BookingQuoteItem,
} from "@/booking-quote/booking-quote";
import { isContactSafeBookingRequestText } from "./booking-request-content";
import {
  isBookingRequestStatus,
  type BookingRequestStatus,
} from "./booking-request-status";

export interface OwnerBookingRequestNotification {
  id: string;
  bookingRequestReference: string;
  status: BookingRequestStatus;
  customerName: string;
  partySize: number;
  bookingNote: string | null;
  cottageName: string;
  bookingPeriod: BookingQuoteItem[];
  bookingPriceIqd: number;
  marketplaceCommissionFils: number;
  ownerNetFils: number;
  houseRules: string;
  bookingTermsVersion: string;
  cancellationPolicyVersion: string;
  statusNotifications: readonly {
    id: string;
    status: Exclude<BookingRequestStatus, "pending" | "processing">;
    createdAt: string;
  }[];
  responseDeadline: string;
  createdAt: string;
}

const keys = new Set([
  "id",
  "bookingRequestReference",
  "status",
  "customerName",
  "partySize",
  "bookingNote",
  "cottageName",
  "bookingPeriod",
  "bookingPriceIqd",
  "marketplaceCommissionFils",
  "ownerNetFils",
  "houseRules",
  "bookingTermsVersion",
  "cancellationPolicyVersion",
  "statusNotifications",
  "responseDeadline",
  "createdAt",
]);
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function notificationFrom(
  value: unknown,
): OwnerBookingRequestNotification | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const notification = value as Record<string, unknown>;
  const actualKeys = Object.keys(notification);
  if (
    actualKeys.length !== keys.size ||
    actualKeys.some((key) => !keys.has(key)) ||
    typeof notification.id !== "string" ||
    !uuid.test(notification.id) ||
    typeof notification.bookingRequestReference !== "string" ||
    !/^RC-REQ-[A-F0-9]{16}$/.test(notification.bookingRequestReference) ||
    !isBookingRequestStatus(notification.status) ||
    typeof notification.customerName !== "string" ||
    notification.customerName.length < 2 ||
    notification.customerName.length > 120 ||
    notification.customerName !== notification.customerName.trim() ||
    !isContactSafeBookingRequestText(notification.customerName) ||
    !Number.isSafeInteger(notification.partySize) ||
    (notification.partySize as number) < 1 ||
    (notification.bookingNote !== null &&
      (typeof notification.bookingNote !== "string" ||
        notification.bookingNote.length === 0 ||
        notification.bookingNote.length > 500 ||
        notification.bookingNote !== notification.bookingNote.trim() ||
        !isContactSafeBookingRequestText(notification.bookingNote))) ||
    typeof notification.cottageName !== "string" ||
    !notification.cottageName.trim() ||
    !Array.isArray(notification.bookingPeriod) ||
    !validateQuotedItems(notification.bookingPeriod as BookingQuoteItem[]) ||
    !Number.isSafeInteger(notification.bookingPriceIqd) ||
    (notification.bookingPriceIqd as number) <= 0 ||
    !Number.isSafeInteger((notification.bookingPriceIqd as number) * 1000) ||
    !Number.isSafeInteger(notification.marketplaceCommissionFils) ||
    (notification.marketplaceCommissionFils as number) <= 0 ||
    !Number.isSafeInteger(notification.ownerNetFils) ||
    (notification.ownerNetFils as number) <= 0 ||
    !Number.isSafeInteger(
      (notification.marketplaceCommissionFils as number) +
        (notification.ownerNetFils as number),
    ) ||
    (notification.marketplaceCommissionFils as number) +
      (notification.ownerNetFils as number) !==
      (notification.bookingPriceIqd as number) * 1000 ||
    typeof notification.houseRules !== "string" ||
    !notification.houseRules.trim() ||
    typeof notification.bookingTermsVersion !== "string" ||
    !notification.bookingTermsVersion.trim() ||
    typeof notification.cancellationPolicyVersion !== "string" ||
    !notification.cancellationPolicyVersion.trim() ||
    !Array.isArray(notification.statusNotifications) ||
    notification.statusNotifications.some((receipt) => {
      const row = receipt as Record<string, unknown>;
      return (
        !row ||
        typeof row.id !== "string" ||
        !uuid.test(row.id) ||
        !isBookingRequestStatus(row.status) ||
        row.status === "pending" ||
        row.status === "processing" ||
        !validTimestamp(row.createdAt)
      );
    }) ||
    !validTimestamp(notification.responseDeadline) ||
    !validTimestamp(notification.createdAt)
  ) {
    return undefined;
  }
  const bookingPeriod = (notification.bookingPeriod as BookingQuoteItem[]).map(
    (item): BookingQuoteItem =>
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
  const statusNotifications = (
    notification.statusNotifications as OwnerBookingRequestNotification["statusNotifications"]
  ).map((receipt) => ({
    id: receipt.id,
    status: receipt.status,
    createdAt: receipt.createdAt,
  }));
  return {
    id: notification.id,
    bookingRequestReference: notification.bookingRequestReference,
    status: notification.status,
    customerName: notification.customerName,
    partySize: notification.partySize as number,
    bookingNote: notification.bookingNote as string | null,
    cottageName: notification.cottageName,
    bookingPeriod,
    bookingPriceIqd: notification.bookingPriceIqd as number,
    marketplaceCommissionFils: notification.marketplaceCommissionFils as number,
    ownerNetFils: notification.ownerNetFils as number,
    houseRules: notification.houseRules,
    bookingTermsVersion: notification.bookingTermsVersion,
    cancellationPolicyVersion: notification.cancellationPolicyVersion,
    statusNotifications,
    responseDeadline: notification.responseDeadline,
    createdAt: notification.createdAt,
  };
}

export async function listOwnerBookingRequestNotifications(
  client: SupabaseClient,
): Promise<OwnerBookingRequestNotification[]> {
  const { data, error } = await client.rpc(
    "list_owner_booking_request_notifications",
  );
  if (error || !Array.isArray(data)) {
    throw new Error("Owner Booking Request notifications are unavailable");
  }
  const notifications = data.map(notificationFrom);
  if (notifications.some((notification) => notification === undefined)) {
    throw new Error("Owner Booking Request notification data is invalid");
  }
  return notifications as OwnerBookingRequestNotification[];
}
