import type { SupabaseClient } from "@supabase/supabase-js";

import {
  validateQuotedItems,
  type BookingQuoteItem,
} from "@/booking-quote/booking-quote";
import { isContactSafeBookingRequestText } from "./booking-request-content";

export interface OwnerBookingRequestNotification {
  bookingRequestReference: string;
  status: "pending";
  customerName: string;
  partySize: number;
  bookingNote: string | null;
  cottageName: string;
  bookingPeriod: BookingQuoteItem[];
  responseDeadline: string;
  createdAt: string;
}

const keys = new Set([
  "bookingRequestReference",
  "status",
  "customerName",
  "partySize",
  "bookingNote",
  "cottageName",
  "bookingPeriod",
  "responseDeadline",
  "createdAt",
]);

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
    typeof notification.bookingRequestReference !== "string" ||
    notification.status !== "pending" ||
    typeof notification.customerName !== "string" ||
    notification.customerName.length < 2 ||
    !isContactSafeBookingRequestText(notification.customerName) ||
    !Number.isSafeInteger(notification.partySize) ||
    (notification.partySize as number) < 1 ||
    (notification.bookingNote !== null &&
      (typeof notification.bookingNote !== "string" ||
        !isContactSafeBookingRequestText(notification.bookingNote))) ||
    typeof notification.cottageName !== "string" ||
    !notification.cottageName.trim() ||
    !Array.isArray(notification.bookingPeriod) ||
    !validateQuotedItems(notification.bookingPeriod as BookingQuoteItem[]) ||
    !validTimestamp(notification.responseDeadline) ||
    !validTimestamp(notification.createdAt)
  ) {
    return undefined;
  }
  return notification as unknown as OwnerBookingRequestNotification;
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
