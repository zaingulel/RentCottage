import { describe, expect, it } from "vitest";

import {
  BOOKING_SERVICE_FEE_IQD,
  MARKETPLACE_COMMISSION_BASIS_POINTS,
  bookingQuoteTotals,
  continuousFullDayAccess,
  isPublicCottageSlug,
  validateQuotedItems,
} from "./booking-quote";

const fullDay = (serviceDay: string, startsAt: string, endsAt: string) => ({
  serviceDay,
  kind: "full-day" as const,
  displayName: "Full-day bundle",
  startsAt,
  endsAt,
  crossesMidnight: endsAt.slice(0, 10) > serviceDay,
  priceIqd: 180_000,
});

describe("Booking Quote", () => {
  it("calculates the fixed fee, Customer Total, and exact commission without floating point", () => {
    expect(BOOKING_SERVICE_FEE_IQD).toBe(5_000);
    expect(MARKETPLACE_COMMISSION_BASIS_POINTS).toBe(1_000);
    expect(bookingQuoteTotals([100_003, 80_000])).toEqual({
      bookingPriceIqd: 180_003,
      serviceFeeIqd: 5_000,
      customerTotalIqd: 185_003,
      commissionRateBasisPoints: 1_000,
      commissionAmountFils: 18_000_300,
    });
    expect(() => bookingQuoteTotals([Number.MAX_SAFE_INTEGER, 1])).toThrow(
      "safe whole IQD",
    );
  });

  it("accepts only the exact opaque public Cottage slug", () => {
    expect(
      isPublicCottageSlug("cottage-00000000000040008000000000000029"),
    ).toBe(true);
    expect(
      isPublicCottageSlug("cottage-ABCDEF00000000000000000000000000"),
    ).toBe(false);
    expect(
      isPublicCottageSlug("cottage-000000000000400080000000000000290"),
    ).toBe(false);
  });

  it("validates exact Iraq-local timestamps and cross-midnight truth", () => {
    expect(
      validateQuotedItems([
        {
          serviceDay: "2026-08-21",
          kind: "shift",
          position: 2,
          displayName: "Night",
          startsAt: "2026-08-21T20:00:00+03:00",
          endsAt: "2026-08-22T02:00:00+03:00",
          crossesMidnight: true,
          priceIqd: 100_000,
        },
      ]),
    ).toBe(true);
    expect(
      validateQuotedItems([
        {
          serviceDay: "2026-08-21",
          kind: "shift",
          position: 2,
          displayName: "Night",
          startsAt: "2026-08-21T20:00:00Z",
          endsAt: "2026-08-22T02:00:00Z",
          crossesMidnight: false,
          priceIqd: 100_000,
        },
      ]),
    ).toBe(false);
    expect(
      validateQuotedItems([
        {
          serviceDay: "2026-02-31",
          kind: "shift",
          position: 2,
          displayName: "Night",
          startsAt: "2026-02-31T20:00:00+03:00",
          endsAt: "2026-03-01T02:00:00+03:00",
          crossesMidnight: true,
          priceIqd: 100_000,
        },
      ]),
    ).toBe(false);
  });

  it("accepts dated 24-hour Full-day access without changing independent prices", () => {
    const items = [
      {
        ...fullDay(
          "2026-08-21",
          "2026-08-21T09:00:00+03:00",
          "2026-08-22T09:00:00+03:00",
        ),
        priceIqd: 250_000,
      },
      {
        ...fullDay(
          "2026-08-22",
          "2026-08-22T09:00:00+03:00",
          "2026-08-23T09:00:00+03:00",
        ),
        priceIqd: 260_000,
      },
    ];

    expect(validateQuotedItems(items)).toBe(true);
    expect(
      validateQuotedItems([
        { ...items[0], endsAt: items[0].startsAt, crossesMidnight: false },
      ]),
    ).toBe(false);
    expect(
      validateQuotedItems([{ ...items[0], crossesMidnight: false }]),
    ).toBe(false);
    expect(continuousFullDayAccess(items)).toEqual([
      {
        fromServiceDay: "2026-08-21",
        toServiceDay: "2026-08-22",
        startsAt: "2026-08-21T09:00:00+03:00",
        endsAt: "2026-08-23T09:00:00+03:00",
      },
    ]);
    expect(bookingQuoteTotals(items.map((item) => item.priceIqd))).toEqual({
      bookingPriceIqd: 510_000,
      serviceFeeIqd: 5_000,
      customerTotalIqd: 515_000,
      commissionRateBasisPoints: 1_000,
      commissionAmountFils: 51_000_000,
    });
    expect(items.map((item) => item.priceIqd)).toEqual([250_000, 260_000]);
  });

  it("merges only consecutive full-day access into one continuous range", () => {
    expect(
      continuousFullDayAccess([
        fullDay(
          "2026-08-21",
          "2026-08-21T08:00:00+03:00",
          "2026-08-21T23:00:00+03:00",
        ),
        fullDay(
          "2026-08-22",
          "2026-08-22T08:00:00+03:00",
          "2026-08-23T02:00:00+03:00",
        ),
        fullDay(
          "2026-08-24",
          "2026-08-24T08:00:00+03:00",
          "2026-08-24T23:00:00+03:00",
        ),
      ]),
    ).toEqual([
      {
        fromServiceDay: "2026-08-21",
        toServiceDay: "2026-08-22",
        startsAt: "2026-08-21T08:00:00+03:00",
        endsAt: "2026-08-23T02:00:00+03:00",
      },
      {
        fromServiceDay: "2026-08-24",
        toServiceDay: "2026-08-24",
        startsAt: "2026-08-24T08:00:00+03:00",
        endsAt: "2026-08-24T23:00:00+03:00",
      },
    ]);
  });
});
