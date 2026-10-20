import { describe, expect, it } from "vitest";
import type { OwnerBookingEarningsFacts } from "@/booking-request/owner-booking-earnings";
import {
  bookingMoneyFigures,
  bookingMoneyPage,
  bookingMoneySummary,
  parseBookingMoneyResult,
  parseBookingMoneySearch,
  type BookingMoneyRow,
} from "./administrator-booking-money";

const zero = { bookingPriceFils: 0, bookingServiceFeeFils: 0 };
const maturity = {
  status: "completed",
  effectivePeriodEnd: "2101-01-01T12:00:00Z",
  assessedAt: "2101-01-01T12:00:01Z",
  reviewExpiresAt: "2101-01-15T12:00:00Z",
  reviewAvailable: true,
  payoutPrerequisiteAt: "2101-01-01T12:00:00Z",
  payoutPrerequisiteAvailable: true,
} as const;
const uuid = (n: number) =>
  `43000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const reference = (n: number) =>
  `RC-REQ-${n.toString(16).toUpperCase().padStart(16, "0")}`;
const confirmedAt = (n: number) =>
  new Date(Date.UTC(2026, 9, 1, 0, 0, n))
    .toISOString()
    .replace(".000Z", ".123456+00:00");

// Price 100,000 IQD and fee 5,000 IQD, paid out at 90,000 IQD, then 10,000 IQD of price and 2,000 IQD of fee refunded.
const paidThenRefunded: OwnerBookingEarningsFacts = {
  status: "captured",
  captured: { bookingPriceFils: 100_000_000, bookingServiceFeeFils: 5_000_000 },
  refunded: { bookingPriceFils: 10_000_000, bookingServiceFeeFils: 2_000_000 },
  reserved: zero,
  obligation: zero,
  marketplaceCommissionRateBasisPoints: 1_000,
  marketplaceCommissionAmountFils: 10_000_000,
  refunds: [
    {
      state: "succeeded",
      allocation: {
        bookingPriceFils: 10_000_000,
        bookingServiceFeeFils: 2_000_000,
      },
    },
  ],
  maturity,
  administratorHoldActive: false,
  disputes: [],
  settlement: {
    amountFils: 90_000_000,
    state: "succeeded",
    retrySafe: false,
    receipt: { paidFils: 90_000_000, recordedAt: "2101-01-02T12:00:00Z" },
  },
  recovery: {
    status: "paid",
    paidFils: 90_000_000,
    ownerEntitlementFils: 81_000_000,
    paidWhileBlocked: false,
    recoveryExposureFils: 9_000_000,
    recoveryBalanceFils: 9_000_000,
    automaticOwnerDebitFils: 0,
  },
};
const paidRefundRecord = {
  id: uuid(900),
  source: "administrator",
  state: "succeeded",
  bookingPriceFils: 10_000_000,
  bookingServiceFeeFils: 2_000_000,
  requestedAt: "2026-10-02T09:00:00.000001+00:00",
} as const;
const eligibleEarnings: OwnerBookingEarningsFacts = {
  ...paidThenRefunded,
  captured: { bookingPriceFils: 20_000_000, bookingServiceFeeFils: 1_000_000 },
  refunded: zero,
  marketplaceCommissionAmountFils: 2_000_000,
  refunds: [],
  settlement: null,
  recovery: { status: "unsettled" },
};
const pendingRefundEarnings: OwnerBookingEarningsFacts = {
  ...eligibleEarnings,
  captured: { bookingPriceFils: 50_000_000, bookingServiceFeeFils: 2_000_000 },
  reserved: { bookingPriceFils: 5_000_000, bookingServiceFeeFils: 500_000 },
  marketplaceCommissionAmountFils: 5_000_000,
  refunds: [
    {
      state: "requested",
      allocation: {
        bookingPriceFils: 5_000_000,
        bookingServiceFeeFils: 500_000,
      },
    },
  ],
};
const bookingRow = (
  n: number,
  change: Partial<BookingMoneyRow> = {},
): BookingMoneyRow => ({
  bookingRequestId: uuid(n),
  reference: reference(n),
  confirmedAt: confirmedAt(n),
  state: "completed",
  earnings: paidThenRefunded,
  refundRecords: [paidRefundRecord],
  settlementIntentId: uuid(800 + n),
  ...change,
});

describe("administrator booking money derivation", () => {
  it("derives the figures of a paid booking with a later refund", () => {
    expect(bookingMoneyFigures(bookingRow(1))).toEqual({
      status: "available",
      figures: {
        bookingPriceFils: 100_000_000,
        bookingServiceFeeFils: 5_000_000,
        customerTotalFils: 105_000_000,
        commissionAtCaptureFils: 10_000_000,
        refundedBookingPriceFils: 10_000_000,
        refundedBookingServiceFeeFils: 2_000_000,
        pendingRefundFils: 0,
        commissionAfterRefundsFils: 9_000_000,
        ownerShareAtCaptureFils: 90_000_000,
        ownerShareAfterRefundsFils: 81_000_000,
        ownerShareReductionFils: 9_000_000,
        paidPayoutFils: 90_000_000,
        expectedUnpaidPayoutFils: 0,
        toRecoverFils: 9_000_000,
      },
    });
  });

  it("flags a booking whose refund records do not add up to its refunded amount", () => {
    const unavailable = { status: "unavailable" };
    expect(
      bookingMoneyFigures(
        bookingRow(1, {
          refundRecords: [{ ...paidRefundRecord, bookingPriceFils: 9_000_000 }],
        }),
      ),
    ).toEqual(unavailable);
    expect(
      bookingMoneyFigures(
        bookingRow(1, {
          refundRecords: [
            paidRefundRecord,
            { ...paidRefundRecord, id: uuid(901) },
          ],
        }),
      ),
    ).toEqual(unavailable);
    expect(
      bookingMoneyFigures(
        bookingRow(1, {
          refundRecords: [
            paidRefundRecord,
            { ...paidRefundRecord, id: uuid(901), state: "requested" },
          ],
        }),
      ),
    ).toEqual(unavailable);
  });

  it("flags a booking whose payout record and settlement facts disagree", () => {
    const unavailable = { status: "unavailable" };
    expect(
      bookingMoneyFigures(bookingRow(1, { settlementIntentId: null })),
    ).toEqual(unavailable);
    expect(
      bookingMoneyFigures(
        bookingRow(1, {
          earnings: {
            ...paidThenRefunded,
            settlement: null,
            recovery: { status: "unsettled" },
          },
        }),
      ),
    ).toEqual(unavailable);
  });

  it("sums a selection and reconciles Booking Price to refunds, commission and owner share", () => {
    const summary = bookingMoneySummary({
      bookings: [
        bookingRow(1),
        bookingRow(2, {
          earnings: eligibleEarnings,
          refundRecords: [],
          settlementIntentId: null,
        }),
        bookingRow(3, {
          state: "confirmed",
          earnings: pendingRefundEarnings,
          refundRecords: [
            {
              ...paidRefundRecord,
              id: uuid(902),
              state: "requested",
              bookingPriceFils: 5_000_000,
              bookingServiceFeeFils: 500_000,
            },
          ],
          settlementIntentId: null,
        }),
      ],
      missingPaymentEvidence: [],
    });
    expect(summary.bookingCount).toBe(3);
    expect(summary.flagged).toEqual([]);
    expect(summary.totals).toEqual({
      status: "available",
      figures: {
        bookingPriceFils: 170_000_000,
        bookingServiceFeeFils: 8_000_000,
        customerTotalFils: 178_000_000,
        commissionAtCaptureFils: 17_000_000,
        refundedBookingPriceFils: 10_000_000,
        refundedBookingServiceFeeFils: 2_000_000,
        pendingRefundFils: 5_500_000,
        commissionAfterRefundsFils: 16_000_000,
        ownerShareAtCaptureFils: 153_000_000,
        ownerShareAfterRefundsFils: 144_000_000,
        ownerShareReductionFils: 9_000_000,
        paidPayoutFils: 90_000_000,
        expectedUnpaidPayoutFils: 63_000_000,
        toRecoverFils: 9_000_000,
      },
    });
    if (summary.totals.status !== "available") return;
    const { figures } = summary.totals;
    expect(figures.bookingPriceFils).toBe(
      figures.refundedBookingPriceFils +
        figures.commissionAfterRefundsFils +
        figures.ownerShareAfterRefundsFils,
    );
  });

  it("withholds money totals when any booking is flagged", () => {
    const flaggedRows = [
      bookingRow(2, { earnings: { status: "unavailable" } }),
      bookingRow(2, {
        earnings: { ...paidThenRefunded, marketplaceCommissionAmountFils: 9 },
      }),
    ];
    for (const flagged of flaggedRows) {
      const summary = bookingMoneySummary({
        bookings: [bookingRow(1), flagged],
        missingPaymentEvidence: [],
      });
      expect(summary.bookingCount).toBe(2);
      expect(summary.totals).toEqual({ status: "unavailable" });
      expect(summary.flagged).toEqual([
        {
          bookingRequestId: uuid(2),
          reference: reference(2),
          confirmedAt: confirmedAt(2),
        },
      ]);
    }
  });

  it("withholds money totals when a confirmation lacks payment prerequisites", () => {
    const missing = {
      bookingRequestId: uuid(7),
      reference: reference(7),
      confirmedAt: confirmedAt(7),
    };
    const summary = bookingMoneySummary({
      bookings: [
        bookingRow(1),
        bookingRow(9, { earnings: { status: "unavailable" } }),
      ],
      missingPaymentEvidence: [missing],
    });
    expect(summary.bookingCount).toBe(3);
    expect(summary.totals).toEqual({ status: "unavailable" });
    expect(summary.flagged).toEqual([
      {
        bookingRequestId: uuid(9),
        reference: reference(9),
        confirmedAt: confirmedAt(9),
      },
      missing,
    ]);

    const missingOnly = bookingMoneySummary({
      bookings: [],
      missingPaymentEvidence: [missing],
    });
    expect(missingOnly.bookingCount).toBe(1);
    expect(missingOnly.totals).toEqual({ status: "unavailable" });
    expect(missingOnly.flagged).toEqual([missing]);
  });

  it("reports an unsafe sum with nothing flagged as overflow", () => {
    const huge: OwnerBookingEarningsFacts = {
      ...eligibleEarnings,
      captured: {
        bookingPriceFils: 5_000_000_000_000_000,
        bookingServiceFeeFils: 0,
      },
      marketplaceCommissionAmountFils: 500_000_000_000_000,
    };
    const hugeRow = (n: number) =>
      bookingRow(n, {
        earnings: huge,
        refundRecords: [],
        settlementIntentId: null,
      });
    const summary = bookingMoneySummary({
      bookings: [hugeRow(1), hugeRow(2)],
      missingPaymentEvidence: [],
    });
    expect(summary.flagged).toEqual([]);
    expect(summary.totals).toEqual({ status: "overflow" });
  });

  it("rejects a malformed reply instead of repairing it", () => {
    const missing = (n: number) => ({
      bookingRequestId: uuid(n),
      reference: reference(n),
      confirmedAt: confirmedAt(n),
    });
    const ready = (
      bookings: unknown[] = [bookingRow(1)],
      missingPaymentEvidence: unknown[] = [missing(2)],
    ) => ({ status: "ready", bookings, missingPaymentEvidence });
    const rows = (from: number, count: number) =>
      Array.from({ length: count }, (_, i) => bookingRow(from + i));
    const missingRows = (from: number, count: number) =>
      Array.from({ length: count }, (_, i) => missing(from + i));

    expect(parseBookingMoneyResult(ready(), null)).toEqual({
      status: "ready",
      bookings: [bookingRow(1)],
      missingPaymentEvidence: [missing(2)],
    });
    expect(
      parseBookingMoneyResult({ status: "too_many", limit: 500 }, null),
    ).toEqual({ status: "too_many", limit: 500 });
    expect(
      parseBookingMoneyResult(ready(rows(1, 400), missingRows(401, 100)), null),
    ).toMatchObject({ status: "ready" });
    expect(
      parseBookingMoneyResult(ready([bookingRow(1)]), "completed"),
    ).toMatchObject({ status: "ready" });
    const withoutSettlement = Object.fromEntries(
      Object.entries(bookingRow(1)).filter(
        ([key]) => key !== "settlementIntentId",
      ),
    );

    const malformed: [string, unknown, string | null][] = [
      ["an unknown status", { ...ready(), status: "partial" }, null],
      ["an extra top-level key", { ...ready(), total: 1 }, null],
      [
        "a missing evidence array",
        { status: "ready", bookings: [bookingRow(1)] },
        null,
      ],
      ["a ready reply with a limit", { ...ready(), limit: 500 }, null],
      [
        "a refusal with rows",
        { status: "too_many", limit: 500, bookings: [] },
        null,
      ],
      [
        "a refusal with a fractional limit",
        { status: "too_many", limit: 1.5 },
        null,
      ],
      [
        "a refusal with a negative limit",
        { status: "too_many", limit: -1 },
        null,
      ],
      ["an extra booking key", ready([{ ...bookingRow(1), owner: "x" }]), null],
      ["a missing booking key", ready([withoutSettlement]), null],
      [
        "an extra evidence key",
        ready([], [{ ...missing(2), state: "x" }]),
        null,
      ],
      ["a duplicate booking", ready([bookingRow(1), bookingRow(1)], []), null],
      [
        "a duplicate across both arrays",
        ready([bookingRow(1)], [missing(1)]),
        null,
      ],
      [
        "501 rows across both arrays",
        ready(rows(1, 401), missingRows(402, 100)),
        null,
      ],
      ["501 booking rows", ready(rows(1, 501), []), null],
      ["a state outside the filter", ready([bookingRow(1)]), "cancelled"],
      [
        "an unknown state",
        ready([bookingRow(1, { state: "paid" as never })]),
        null,
      ],
      [
        "a non-integer refund amount",
        ready([
          bookingRow(1, {
            refundRecords: [{ ...paidRefundRecord, bookingPriceFils: 1.5 }],
          }),
        ]),
        null,
      ],
      [
        "a negative refund amount",
        ready([
          bookingRow(1, {
            refundRecords: [{ ...paidRefundRecord, bookingPriceFils: -1 }],
          }),
        ]),
        null,
      ],
      [
        "an unknown refund source",
        ready([
          bookingRow(1, {
            refundRecords: [{ ...paidRefundRecord, source: "owner" as never }],
          }),
        ]),
        null,
      ],
      [
        "an unknown refund state",
        ready([
          bookingRow(1, {
            refundRecords: [{ ...paidRefundRecord, state: "paid" as never }],
          }),
        ]),
        null,
      ],
      [
        "a refund time without an offset",
        ready([
          bookingRow(1, {
            refundRecords: [
              { ...paidRefundRecord, requestedAt: "2026-10-02T09:00:00" },
            ],
          }),
        ]),
        null,
      ],
      [
        "a non-integer earnings amount",
        ready([
          bookingRow(1, {
            earnings: {
              ...paidThenRefunded,
              captured: {
                bookingPriceFils: 100_000_000.5,
                bookingServiceFeeFils: 5_000_000,
              },
            },
          }),
        ]),
        null,
      ],
      [
        "a reference outside the pattern",
        ready([bookingRow(1, { reference: "RC-REQ-1" })]),
        null,
      ],
      [
        "a confirmation time in Z form",
        ready([bookingRow(1, { confirmedAt: "2026-10-01T00:00:01.123456Z" })]),
        null,
      ],
      [
        "a confirmation time with three digits",
        ready([
          bookingRow(1, { confirmedAt: "2026-10-01T00:00:01.123+00:00" }),
        ]),
        null,
      ],
      [
        "an uppercase identifier",
        ready([
          bookingRow(1, {
            bookingRequestId: "43000000-0000-4000-8000-00000000000A",
          }),
        ]),
        null,
      ],
      [
        "a settlement identifier that is not a uuid",
        ready([bookingRow(1, { settlementIntentId: "x" })]),
        null,
      ],
      ["a non-object reply", [], null],
    ];
    for (const [label, reply, requestedState] of malformed)
      expect(
        () => parseBookingMoneyResult(reply, requestedState),
        label,
      ).toThrow();
  });

  it("pages by keyset and survives a row leaving the selection", () => {
    const newestFirst = Array.from({ length: 30 }, (_, i) =>
      bookingRow(30 - i),
    );
    const cursorAfter = (n: number) => ({
      afterAt: confirmedAt(n),
      afterId: uuid(n),
    });
    const ids = (rows: readonly BookingMoneyRow[]) =>
      rows.map((row) => row.bookingRequestId);
    const none = { afterAt: null, afterId: null };

    const first = bookingMoneyPage(newestFirst, none);
    expect(ids(first.rows)).toEqual(
      newestFirst.slice(0, 25).map((r) => r.bookingRequestId),
    );
    expect(first.nextCursor).toEqual(cursorAfter(6));
    const second = bookingMoneyPage(newestFirst, cursorAfter(6));
    expect(ids(second.rows)).toEqual([5, 4, 3, 2, 1].map(uuid));
    expect(second.nextCursor).toBeNull();

    const withoutCursorRow = newestFirst.filter(
      (row) => row.bookingRequestId !== uuid(6),
    );
    const resumed = bookingMoneyPage(withoutCursorRow, cursorAfter(6));
    expect(ids(resumed.rows)).toEqual([5, 4, 3, 2, 1].map(uuid));

    expect(
      bookingMoneyPage(newestFirst.slice(0, 25), none).nextCursor,
    ).toBeNull();
    const tied = [
      bookingRow(12, { confirmedAt: confirmedAt(20) }),
      bookingRow(11, { confirmedAt: confirmedAt(20) }),
      bookingRow(10, { confirmedAt: confirmedAt(20) }),
    ];
    expect(
      ids(
        bookingMoneyPage(tied, { afterAt: confirmedAt(20), afterId: uuid(11) })
          .rows,
      ),
    ).toEqual([uuid(10)]);

    const cursor = { afterAt: confirmedAt(6), afterId: uuid(6) };
    expect(
      parseBookingMoneySearch({
        state: "completed",
        from: "2026-10-01",
        through: "2026-10-31",
        ...cursor,
      }),
    ).toEqual({
      state: "completed",
      from: "2026-10-01",
      through: "2026-10-31",
      ...cursor,
    });
    expect(parseBookingMoneySearch({})).toEqual({
      state: null,
      from: null,
      through: null,
      afterAt: null,
      afterId: null,
    });
    const refused: [string, unknown][] = [
      ["a queue key", { queue: "bookings" }],
      ["an empty queue key", { queue: "" }],
      ["a state no booking has", { state: "pending" }],
      ["an unknown key", { owner: "x" }],
      ["reversed dates", { from: "2026-10-02", through: "2026-10-01" }],
      ["a cursor without an identifier", { afterAt: cursor.afterAt }],
      [
        "a cursor with a Z form",
        { ...cursor, afterAt: "2026-10-01T00:00:06.123456Z" },
      ],
      [
        "a cursor with three fractional digits",
        { ...cursor, afterAt: "2026-10-01T00:00:06.123+00:00" },
      ],
      [
        "a cursor with another offset",
        { ...cursor, afterAt: "2026-10-01T03:00:06.123456+03:00" },
      ],
      [
        "an uppercase cursor identifier",
        { ...cursor, afterId: "43000000-0000-4000-8000-00000000000A" },
      ],
      ["a non-object search", "completed"],
    ];
    for (const [label, search] of refused)
      expect(() => parseBookingMoneySearch(search), label).toThrow();
  });
});
