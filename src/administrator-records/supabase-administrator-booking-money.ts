import "server-only";

import {
  resolvePlatformAdministratorAccess,
  type PlatformAdministratorAccess,
} from "@/access/platform-administrator-gate";
import { createRequestSupabaseClient } from "@/access/supabase-server";
import {
  bookingMoneyPage,
  bookingMoneySummary,
  parseBookingMoneyResult,
  parseBookingMoneySearch,
  type BookingMoneySearch,
} from "./administrator-booking-money";

type BookingMoneySummary = ReturnType<typeof bookingMoneySummary>;
type BookingMoneyOutcome =
  | {
      status: "ready";
      search: BookingMoneySearch;
      summary: Omit<BookingMoneySummary, "totals"> & {
        totals: Exclude<BookingMoneySummary["totals"], { status: "overflow" }>;
      };
      page: ReturnType<typeof bookingMoneyPage>;
    }
  | { status: "too_many"; search: BookingMoneySearch; limit: number }
  | { status: "invalid" | "access_required" | "unavailable" };

function denied(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "42501"
  );
}

function unavailable(operation: string): { status: "unavailable" } {
  console.error("Administrator records request failed", {
    operation,
    outcome: "unavailable",
  });
  return { status: "unavailable" };
}

export async function readAdministratorBookingMoney(
  input: unknown,
): Promise<BookingMoneyOutcome> {
  let access: PlatformAdministratorAccess;
  try {
    access = await resolvePlatformAdministratorAccess();
  } catch {
    return unavailable("booking_money_authorization");
  }
  if (access !== "allowed") return { status: "access_required" };

  let search: BookingMoneySearch;
  try {
    search = parseBookingMoneySearch(input);
  } catch {
    return { status: "invalid" };
  }

  try {
    const client = await createRequestSupabaseClient();
    const result = await client.rpc("list_administrator_booking_money", {
      target_state: search.state,
      target_from: search.from,
      target_through: search.through,
    });
    if (denied(result.error)) return { status: "access_required" };
    if (result.error) return unavailable("booking_money_read");
    const reply = parseBookingMoneyResult(result.data, search.state);
    if (reply.status === "too_many")
      return { status: "too_many", search, limit: reply.limit };
    const summary = bookingMoneySummary(reply);
    const { totals } = summary;
    if (totals.status === "overflow") return unavailable("booking_money_read");
    return {
      status: "ready",
      search,
      summary: { ...summary, totals },
      page: bookingMoneyPage(reply.bookings, search),
    };
  } catch {
    return unavailable("booking_money_read");
  }
}
