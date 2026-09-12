import type { SupabaseClient } from "@supabase/supabase-js";
import {
  bookingLifecycleStatuses,
  type BookingLifecycleStatus,
} from "./booking-lifecycle";
import {
  bookingRequestStatuses,
  type BookingRequestPaymentStatus,
  type BookingRequestStatus,
} from "./booking-request-status";
import {
  parseOwnerBookingEarningsAvailability,
  type OwnerBookingEarningsFacts,
} from "./owner-booking-earnings";

export type BookingHistoryStatus =
  | BookingRequestStatus
  | BookingRequestPaymentStatus
  | BookingLifecycleStatus;

export interface BookingHistoryItem {
  readonly bookingRequestId: string;
  readonly bookingRequestReference: string;
  readonly bookingReference: string | null;
  readonly receiptId?: string;
  readonly cottageName: string;
  readonly createdAt: string;
  readonly confirmedAt?: string;
  readonly firstStartsAt: string;
  readonly lastEndsAt: string;
  readonly status: BookingHistoryStatus;
  readonly actorRole: "customer" | "cottage_owner";
  readonly ownerEarnings?: OwnerBookingEarningsFacts;
}

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const statuses: readonly BookingHistoryStatus[] = [
  ...bookingRequestStatuses,
  "capture-processing",
  "payment-required",
  "paid-confirmed",
  ...bookingLifecycleStatuses,
];
const timestamp = (value: unknown): value is string =>
  typeof value === "string" &&
  /(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value));

export async function listBookingHistory(
  client: SupabaseClient,
  actorRole: BookingHistoryItem["actorRole"],
): Promise<BookingHistoryItem[]> {
  const { data, error } = await client.rpc("list_booking_history", {
    target_actor_role: actorRole,
  });
  if (error) throw new Error("Booking History is unavailable");
  if (!Array.isArray(data)) throw new Error("Booking History data is invalid");
  return data.map((value) => {
    const v = value as Record<string, unknown>;
    if (
      !v ||
      typeof v.bookingRequestId !== "string" ||
      !uuid.test(v.bookingRequestId) ||
      typeof v.bookingRequestReference !== "string" ||
      !/^RC-REQ-[A-F0-9]{16}$/.test(v.bookingRequestReference) ||
      (v.bookingReference !== undefined &&
        v.bookingReference !== null &&
        typeof v.bookingReference !== "string") ||
      (v.receiptId !== undefined &&
        (typeof v.receiptId !== "string" || !uuid.test(v.receiptId))) ||
      typeof v.cottageName !== "string" ||
      !v.cottageName.trim() ||
      !timestamp(v.createdAt) ||
      (v.confirmedAt !== undefined && !timestamp(v.confirmedAt)) ||
      !timestamp(v.firstStartsAt) ||
      !timestamp(v.lastEndsAt) ||
      Date.parse(v.lastEndsAt) <= Date.parse(v.firstStartsAt) ||
      !statuses.includes(v.status as BookingHistoryStatus) ||
      (v.actorRole !== "customer" && v.actorRole !== "cottage_owner") ||
      v.actorRole !== actorRole ||
      (v.actorRole === "cottage_owner") !== (v.ownerEarnings !== undefined) ||
      (v.receiptId === undefined) !== (v.confirmedAt === undefined) ||
      (v.receiptId === undefined) !==
        (v.bookingReference === null || v.bookingReference === undefined)
    )
      throw new Error("Booking History data is invalid");
    return {
      bookingRequestId: v.bookingRequestId,
      bookingRequestReference: v.bookingRequestReference,
      bookingReference: v.bookingReference ?? null,
      ...(v.receiptId === undefined ? {} : { receiptId: v.receiptId }),
      cottageName: v.cottageName,
      createdAt: v.createdAt,
      ...(v.confirmedAt === undefined ? {} : { confirmedAt: v.confirmedAt }),
      firstStartsAt: v.firstStartsAt,
      lastEndsAt: v.lastEndsAt,
      status: v.status as BookingHistoryStatus,
      actorRole: v.actorRole,
      ...(v.actorRole === "cottage_owner"
        ? {
            ownerEarnings: parseOwnerBookingEarningsAvailability(
              v.ownerEarnings,
            ),
          }
        : {}),
    };
  });
}
