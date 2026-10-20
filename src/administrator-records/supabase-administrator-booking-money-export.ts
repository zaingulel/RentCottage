import "server-only";

import {
  resolvePlatformAdministratorAccess,
  type PlatformAdministratorAccess,
} from "@/access/platform-administrator-gate";
import { createRequestSupabaseClient } from "@/access/supabase-server";
import {
  isOffsetTimestamp,
  rowObject,
} from "@/booking-request/booking-request-row";
import type { Locale } from "@/i18n/routing";
import {
  bookingMoneySummary,
  parseBookingMoneyResult,
  parseBookingMoneySearch,
  type BookingMoneySearch,
} from "./administrator-booking-money";
import {
  administratorBookingMoneyCsv,
  type RecordedBookingMoneyExport,
} from "./administrator-booking-money-export";

export type BookingMoneyExportOutcome =
  | { status: "ready"; csv: string; exportId: string }
  | { status: "too_many"; limit: 500; search: BookingMoneySearch }
  | { status: "empty"; search: BookingMoneySearch }
  | { status: "invalid" | "access_required" | "unavailable" };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const recordedAt = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}\+00:00$/;

function exactObject(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  const raw = rowObject(value);
  if (
    !raw ||
    Object.keys(raw).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(raw, key))
  )
    throw new Error("Invalid recorded money export reply");
  return raw;
}

// The existing parsers validate values; their returned shape also bounds every nested field.
function exactSelectionShape(value: unknown, parsed: unknown): void {
  if (Array.isArray(parsed)) {
    if (!Array.isArray(value) || value.length !== parsed.length)
      throw new Error("Invalid export selection shape");
    parsed.forEach((item, index) => exactSelectionShape(value[index], item));
  } else {
    const expected = rowObject(parsed);
    if (!expected) return;
    const raw = exactObject(value, Object.keys(expected));
    for (const key of Object.keys(expected))
      exactSelectionShape(raw[key], expected[key]);
  }
}

function unavailable(operation: string): { status: "unavailable" } {
  console.error("Administrator records request failed", {
    operation,
    outcome: "unavailable",
  });
  return { status: "unavailable" };
}

export async function exportAdministratorBookingMoney(
  input: unknown,
  locale: Locale,
): Promise<BookingMoneyExportOutcome> {
  let access: PlatformAdministratorAccess;
  try {
    access = await resolvePlatformAdministratorAccess();
  } catch {
    return unavailable("booking_money_export_authorization");
  }
  if (access !== "allowed") return { status: "access_required" };

  let search: BookingMoneySearch;
  try {
    const raw = rowObject(input);
    if (
      !raw ||
      Object.entries(raw).some(
        ([key, value]) =>
          !["state", "from", "through"].includes(key) ||
          typeof value !== "string",
      )
    )
      return { status: "invalid" };
    search = parseBookingMoneySearch(raw);
  } catch {
    return { status: "invalid" };
  }

  try {
    const client = await createRequestSupabaseClient();
    const result = await client.rpc(
      "record_administrator_booking_money_export",
      {
        target_state: search.state,
        target_from: search.from,
        target_through: search.through,
      },
    );
    if (rowObject(result.error)?.code === "42501")
      return { status: "access_required" };
    if (result.error) return unavailable("booking_money_export");
    const status = rowObject(result.data)?.status;
    if (status === "empty") {
      exactObject(result.data, ["status"]);
      return { status: "empty", search };
    }
    if (status === "too_many") {
      const refusal = exactObject(result.data, ["status", "limit"]);
      if (refusal.limit !== 500)
        throw new Error("Invalid export admission limit");
      return { status: "too_many", limit: 500, search };
    }
    const raw = exactObject(result.data, [
      "status",
      "exportId",
      "recordedAt",
      "selection",
    ]);
    if (
      raw.status !== "recorded" ||
      typeof raw.exportId !== "string" ||
      !uuid.test(raw.exportId) ||
      !isOffsetTimestamp(raw.recordedAt) ||
      !recordedAt.test(raw.recordedAt)
    )
      throw new Error("Invalid export recording envelope");
    const selection = parseBookingMoneyResult(raw.selection, search.state);
    if (selection.status !== "ready")
      throw new Error("Invalid recorded selection");
    exactSelectionShape(raw.selection, selection);
    const refundIds = new Set<string>();
    for (const booking of selection.bookings)
      for (const refund of booking.refundRecords) {
        if (refundIds.has(refund.id))
          throw new Error("Duplicate refund in export selection");
        refundIds.add(refund.id);
      }
    const summary = bookingMoneySummary(selection);
    if (summary.bookingCount === 0 || summary.totals.status === "overflow")
      throw new Error("Invalid recorded export cardinality or total");
    const record: RecordedBookingMoneyExport = {
      exportId: raw.exportId,
      recordedAt: raw.recordedAt,
      selection,
    };
    return {
      status: "ready",
      exportId: record.exportId,
      csv: administratorBookingMoneyCsv(record, locale),
    };
  } catch {
    return unavailable("booking_money_export");
  }
}
