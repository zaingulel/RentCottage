import {
  bookingLifecycleStatuses,
  type BookingLifecycleStatus,
} from "./booking-lifecycle";
import type { SupabaseClient } from "@supabase/supabase-js";
export type ConfirmedBookingHistoryItem = {
  readonly receiptId: string;
  readonly bookingRequestReference: string;
  readonly bookingReference: string;
  readonly cottageName: string;
  readonly confirmedAt: string;
  readonly cancelled: boolean;
  readonly lifecycleStatus: BookingLifecycleStatus;
  readonly actorRole: "customer" | "cottage_owner";
};
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function listConfirmedBookingHistory(
  client: SupabaseClient,
): Promise<ConfirmedBookingHistoryItem[]> {
  const { data, error } = await client.rpc("list_confirmed_booking_history");
  if (error) throw new Error("Booking History is unavailable");
  if (!Array.isArray(data)) throw new Error("Booking History data is invalid");
  return data.map((value) => {
    const v = value as Record<string, unknown>;
    if (
      !v ||
      typeof v.receiptId !== "string" ||
      !uuid.test(v.receiptId) ||
      typeof v.bookingRequestReference !== "string" ||
      !/^RC-REQ-[A-F0-9]{16}$/.test(v.bookingRequestReference) ||
      typeof v.bookingReference !== "string" ||
      typeof v.cottageName !== "string" ||
      typeof v.cancelled !== "boolean" ||
      !bookingLifecycleStatuses.includes(
        v.lifecycleStatus as BookingLifecycleStatus,
      ) ||
      typeof v.confirmedAt !== "string" ||
      Number.isNaN(Date.parse(v.confirmedAt)) ||
      (v.actorRole !== "customer" && v.actorRole !== "cottage_owner")
    )
      throw new Error("Booking History data is invalid");
    return {
      receiptId: v.receiptId,
      bookingRequestReference: v.bookingRequestReference,
      bookingReference: v.bookingReference,
      cottageName: v.cottageName,
      confirmedAt: v.confirmedAt,
      cancelled: v.cancelled,
      lifecycleStatus: v.lifecycleStatus as BookingLifecycleStatus,
      actorRole: v.actorRole,
    };
  });
}
