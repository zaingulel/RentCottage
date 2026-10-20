import {
  isOffsetTimestamp,
  rowObject,
} from "@/booking-request/booking-request-row";
import {
  ownerBookingEarnings,
  parseOwnerBookingEarningsFacts,
  type OwnerBookingEarnings,
  type OwnerBookingEarningsFacts,
} from "@/booking-request/owner-booking-earnings";
import {
  administratorQueueStates,
  parseAdministratorQueueSearch,
} from "./administrator-records";

type RefundRecordState =
  | "requested"
  | "processing"
  | "unknown"
  | "succeeded"
  | "failed";
type CapturedFacts = Extract<OwnerBookingEarningsFacts, { status: "captured" }>;
type CapturedEarnings = Exclude<
  OwnerBookingEarnings,
  { status: "not-captured" | "unavailable" }
>;

export type BookingMoneyRefundRecord = {
  readonly id: string;
  readonly source: "cancellation" | "administrator" | "dispute";
  readonly state: RefundRecordState;
  readonly bookingPriceFils: number;
  readonly bookingServiceFeeFils: number;
  readonly requestedAt: string;
};
export type BookingMoneyMissingEvidence = {
  readonly bookingRequestId: string;
  readonly reference: string;
  readonly confirmedAt: string;
};
export type BookingMoneyRow = {
  readonly bookingRequestId: string;
  readonly reference: string;
  readonly confirmedAt: string;
  readonly state: (typeof administratorQueueStates.bookings)[number];
  readonly earnings: OwnerBookingEarningsFacts;
  readonly refundRecords: readonly BookingMoneyRefundRecord[];
  readonly settlementIntentId: string | null;
};

export type BookingMoneySearch = {
  readonly state: string | null;
  readonly from: string | null;
  readonly through: string | null;
  readonly afterAt: string | null;
  readonly afterId: string | null;
};
export type BookingMoneySelection = {
  readonly bookings: readonly BookingMoneyRow[];
  readonly missingPaymentEvidence: readonly BookingMoneyMissingEvidence[];
};

const figureKeys = [
  "bookingPriceFils",
  "bookingServiceFeeFils",
  "customerTotalFils",
  "commissionAtCaptureFils",
  "refundedBookingPriceFils",
  "refundedBookingServiceFeeFils",
  "pendingRefundFils",
  "commissionAfterRefundsFils",
  "ownerShareAtCaptureFils",
  "ownerShareAfterRefundsFils",
  "ownerShareReductionFils",
  "paidPayoutFils",
  "expectedUnpaidPayoutFils",
  "toRecoverFils",
] as const;
export type BookingMoneyFigures = Record<(typeof figureKeys)[number], number>;

const pendingStates: readonly RefundRecordState[] = [
  "requested",
  "processing",
  "unknown",
];

function recordedRefunds(
  records: BookingMoneyRow["refundRecords"],
  states: readonly RefundRecordState[],
) {
  const included = records.filter((record) => states.includes(record.state));
  return {
    bookingPriceFils: included.reduce(
      (sum, record) => sum + record.bookingPriceFils,
      0,
    ),
    bookingServiceFeeFils: included.reduce(
      (sum, record) => sum + record.bookingServiceFeeFils,
      0,
    ),
  };
}

function recordsAgree(row: BookingMoneyRow, facts: CapturedFacts): boolean {
  const completed = recordedRefunds(row.refundRecords, ["succeeded"]);
  const pending = recordedRefunds(row.refundRecords, pendingStates);
  return (
    completed.bookingPriceFils === facts.refunded.bookingPriceFils &&
    completed.bookingServiceFeeFils === facts.refunded.bookingServiceFeeFils &&
    pending.bookingPriceFils === facts.reserved.bookingPriceFils &&
    pending.bookingServiceFeeFils === facts.reserved.bookingServiceFeeFils &&
    (row.settlementIntentId !== null) === (facts.settlement !== null)
  );
}

/** Unavailable when the booking's money evidence is missing, contradictory or unreadable. */
export function bookingMoneyFigures(
  row: BookingMoneyRow,
):
  | { readonly status: "unavailable" }
  | { readonly status: "available"; readonly figures: BookingMoneyFigures } {
  const facts = row.earnings;
  if (facts.status !== "captured" || !recordsAgree(row, facts))
    return { status: "unavailable" };
  let earnings: CapturedEarnings;
  try {
    // Captured facts only ever derive a captured result.
    earnings = ownerBookingEarnings(facts) as CapturedEarnings;
  } catch {
    return { status: "unavailable" };
  }
  const ownerShareAtCaptureFils =
    earnings.bookingPriceFils - earnings.originalMarketplaceCommissionFils;
  return {
    status: "available",
    figures: {
      bookingPriceFils: earnings.bookingPriceFils,
      bookingServiceFeeFils: earnings.bookingServiceFeeFils,
      customerTotalFils:
        earnings.bookingPriceFils + earnings.bookingServiceFeeFils,
      commissionAtCaptureFils: earnings.originalMarketplaceCommissionFils,
      refundedBookingPriceFils: earnings.completedBookingPriceRefundFils,
      refundedBookingServiceFeeFils:
        earnings.completedBookingServiceFeeRefundFils,
      pendingRefundFils:
        earnings.pendingBookingPriceRefundFils +
        earnings.pendingBookingServiceFeeRefundFils,
      commissionAfterRefundsFils: earnings.currentMarketplaceCommissionFils,
      ownerShareAtCaptureFils,
      ownerShareAfterRefundsFils: earnings.currentNetPayoutFils,
      ownerShareReductionFils:
        ownerShareAtCaptureFils - earnings.currentNetPayoutFils,
      paidPayoutFils: earnings.paidPayoutFils,
      expectedUnpaidPayoutFils: earnings.expectedUnpaidPayoutFils,
      toRecoverFils: earnings.recoveryBalanceFils,
    },
  };
}

// Confirmation time is fixed-width UTC text, so text order is time order.
function newerFirst(
  a: Pick<BookingMoneyRow, "bookingRequestId" | "confirmedAt">,
  b: Pick<BookingMoneyRow, "bookingRequestId" | "confirmedAt">,
): number {
  if (a.confirmedAt !== b.confirmedAt)
    return a.confirmedAt < b.confirmedAt ? 1 : -1;
  if (a.bookingRequestId === b.bookingRequestId) return 0;
  return a.bookingRequestId < b.bookingRequestId ? 1 : -1;
}

/**
 * Money totals exist only when every booking is sound: one flagged booking or one confirmation
 * without payment evidence makes them unavailable, and an unsafe sum is reported as overflow.
 */
export function bookingMoneySummary(selection: BookingMoneySelection): {
  readonly bookingCount: number;
  readonly flagged: readonly BookingMoneyMissingEvidence[];
  readonly totals:
    | { readonly status: "unavailable" | "overflow" }
    | { readonly status: "available"; readonly figures: BookingMoneyFigures };
} {
  const sound: BookingMoneyFigures[] = [];
  const flagged = [...selection.missingPaymentEvidence];
  for (const row of selection.bookings) {
    const derived = bookingMoneyFigures(row);
    if (derived.status === "available") sound.push(derived.figures);
    else
      flagged.push({
        bookingRequestId: row.bookingRequestId,
        reference: row.reference,
        confirmedAt: row.confirmedAt,
      });
  }
  flagged.sort(newerFirst);
  const bookingCount =
    selection.bookings.length + selection.missingPaymentEvidence.length;
  if (flagged.length > 0)
    return { bookingCount, flagged, totals: { status: "unavailable" } };
  const figures = Object.fromEntries(
    figureKeys.map((key) => [
      key,
      sound.reduce((sum, booking) => sum + booking[key], 0),
    ]),
  ) as BookingMoneyFigures;
  return {
    bookingCount,
    flagged,
    totals: Object.values(figures).every(Number.isSafeInteger)
      ? { status: "available", figures }
      : { status: "overflow" },
  };
}

const maxRows = 500;
const referencePattern = /^RC-REQ-[A-F0-9]{16}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const confirmedAtPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}\+00:00$/;
const refundSources = ["cancellation", "administrator", "dispute"] as const;
const refundStates = [
  "requested",
  "processing",
  "unknown",
  "succeeded",
  "failed",
] as const;

function exactObject(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  const raw = rowObject(value);
  const present = raw ? Object.keys(raw) : [];
  if (
    !raw ||
    present.length !== keys.length ||
    !keys.every((key) => present.includes(key))
  )
    throw new Error("Invalid booking money reply");
  return raw;
}
function uuid(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value))
    throw new Error("Invalid booking money identifier");
  return value;
}
function fils(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid booking money amount");
  return value;
}
function choice<T extends string>(value: unknown, options: readonly T[]): T {
  if (!options.includes(value as T))
    throw new Error("Invalid booking money state");
  return value as T;
}
function reference(value: unknown): string {
  if (typeof value !== "string" || !referencePattern.test(value))
    throw new Error("Invalid booking request reference");
  return value;
}
// The exact form the database returns, which the keyset cursor compares as text.
function confirmedAt(value: unknown): string {
  if (
    typeof value !== "string" ||
    !confirmedAtPattern.test(value) ||
    !isOffsetTimestamp(value)
  )
    throw new Error("Invalid booking confirmation time");
  return value;
}
function missingEvidence(value: unknown): BookingMoneyMissingEvidence {
  const raw = exactObject(value, [
    "bookingRequestId",
    "reference",
    "confirmedAt",
  ]);
  return {
    bookingRequestId: uuid(raw.bookingRequestId),
    reference: reference(raw.reference),
    confirmedAt: confirmedAt(raw.confirmedAt),
  };
}
function refundRecord(value: unknown): BookingMoneyRefundRecord {
  const raw = exactObject(value, [
    "id",
    "source",
    "state",
    "bookingPriceFils",
    "bookingServiceFeeFils",
    "requestedAt",
  ]);
  if (!isOffsetTimestamp(raw.requestedAt))
    throw new Error("Invalid refund record time");
  return {
    id: uuid(raw.id),
    source: choice(raw.source, refundSources),
    state: choice(raw.state, refundStates),
    bookingPriceFils: fils(raw.bookingPriceFils),
    bookingServiceFeeFils: fils(raw.bookingServiceFeeFils),
    requestedAt: raw.requestedAt,
  };
}
function bookingRow(
  value: unknown,
  requestedState: string | null,
): BookingMoneyRow {
  const raw = exactObject(value, [
    "bookingRequestId",
    "reference",
    "confirmedAt",
    "state",
    "earnings",
    "refundRecords",
    "settlementIntentId",
  ]);
  const state = choice(raw.state, administratorQueueStates.bookings);
  if (requestedState !== null && state !== requestedState)
    throw new Error("Booking outside the requested status");
  if (!Array.isArray(raw.refundRecords))
    throw new Error("Invalid refund records");
  return {
    bookingRequestId: uuid(raw.bookingRequestId),
    reference: reference(raw.reference),
    confirmedAt: confirmedAt(raw.confirmedAt),
    state,
    earnings: parseOwnerBookingEarningsFacts(raw.earnings),
    refundRecords: raw.refundRecords.map(refundRecord),
    settlementIntentId:
      raw.settlementIntentId === null ? null : uuid(raw.settlementIntentId),
  };
}

export function parseBookingMoneyResult(
  value: unknown,
  requestedState: string | null,
):
  | { readonly status: "too_many"; readonly limit: number }
  | ({ readonly status: "ready" } & BookingMoneySelection) {
  if (rowObject(value)?.status === "too_many") {
    const refusal = exactObject(value, ["status", "limit"]);
    return { status: "too_many", limit: fils(refusal.limit) };
  }
  const raw = exactObject(value, [
    "status",
    "bookings",
    "missingPaymentEvidence",
  ]);
  if (
    raw.status !== "ready" ||
    !Array.isArray(raw.bookings) ||
    !Array.isArray(raw.missingPaymentEvidence) ||
    raw.bookings.length + raw.missingPaymentEvidence.length > maxRows
  )
    throw new Error("Invalid booking money reply");
  const bookings = raw.bookings.map((row) => bookingRow(row, requestedState));
  const missingPaymentEvidence =
    raw.missingPaymentEvidence.map(missingEvidence);
  const identifiers = new Set(
    [...bookings, ...missingPaymentEvidence].map((row) => row.bookingRequestId),
  );
  if (identifiers.size < bookings.length + missingPaymentEvidence.length)
    throw new Error("Duplicate booking in money reply");
  return { status: "ready", bookings, missingPaymentEvidence };
}

const pageSize = 25;

/** Takes the bookings queue filters and refuses a cursor that is not in the form the read returns. */
export function parseBookingMoneySearch(value: unknown): BookingMoneySearch {
  const raw = rowObject(value);
  if (!raw || Object.hasOwn(raw, "queue"))
    throw new Error("Invalid booking money filter");
  const { state, from, through, afterAt, afterId } =
    parseAdministratorQueueSearch({ ...raw, queue: "bookings" });
  if (
    (afterAt !== null && !confirmedAtPattern.test(afterAt)) ||
    (afterId !== null && !uuidPattern.test(afterId))
  )
    throw new Error("Invalid booking money cursor");
  return { state, from, through, afterAt, afterId };
}

/** Cuts one page from rows ordered newest first; a cursor row that left the selection still works. */
export function bookingMoneyPage(
  bookings: readonly BookingMoneyRow[],
  cursor: Pick<BookingMoneySearch, "afterAt" | "afterId">,
): {
  readonly rows: readonly BookingMoneyRow[];
  readonly nextCursor: {
    readonly afterAt: string;
    readonly afterId: string;
  } | null;
} {
  const { afterAt, afterId } = cursor;
  const remaining =
    afterAt === null || afterId === null
      ? bookings
      : bookings.filter(
          (row) =>
            newerFirst(
              { bookingRequestId: afterId, confirmedAt: afterAt },
              row,
            ) < 0,
        );
  const rows = remaining.slice(0, pageSize);
  const last = rows[rows.length - 1];
  return {
    rows,
    nextCursor:
      remaining.length > pageSize
        ? { afterAt: last.confirmedAt, afterId: last.bookingRequestId }
        : null,
  };
}
