import { describe, expect, it } from "vitest";

import { bookingCancellationRefundObligation } from "./booking-cancellation-policy";

const captured = {
  bookingPriceFils: 123_450_000,
  bookingServiceFeeFils: 5_000_000,
};

const purchased = {
  firstStartsAt: "2099-08-22T01:00:00.000+03:00",
  captured,
};

describe("confirmed booking cancellation refund policy", () => {
  it.each([
    ["2099-08-19T22:00:00.000Z", 128_450_000],
    ["2099-08-19T22:00:00.001Z", 0],
    ["2099-08-19T21:59:59.999Z", 128_450_000],
    ["2099-08-21T22:00:00.000Z", 0],
    ["2099-08-22T22:00:00.000Z", 0],
  ] as const)(
    "uses the authoritative instant %s against the purchased first shift",
    (evaluatedAt, amountFils) => {
      expect(
        bookingCancellationRefundObligation({
          ...purchased,
          outcome: "customer_cancellation",
          evaluatedAt,
        }),
      ).toEqual({
        amountFils,
        allocation:
          amountFils === 0
            ? { bookingPriceFils: 0, bookingServiceFeeFils: 0 }
            : {
                bookingPriceFils: 123_450_000,
                bookingServiceFeeFils: 5_000_000,
              },
      });
    },
  );

  it.each(["owner_cancellation", "administrator_cancellation"] as const)(
    "owes the full captured price and fee for %s after the first shift starts",
    (outcome) => {
      expect(
        bookingCancellationRefundObligation({
          ...purchased,
          outcome,
          evaluatedAt: "2099-08-22T05:00:00.000Z",
        }),
      ).toEqual({
        amountFils: 128_450_000,
        allocation: {
          bookingPriceFils: 123_450_000,
          bookingServiceFeeFils: 5_000_000,
        },
      });
    },
  );

  it("applies the no-show financial rule without recording a no-show", () => {
    expect(
      bookingCancellationRefundObligation({
        ...purchased,
        outcome: "no_show",
        evaluatedAt: "2099-08-22T05:00:00.000Z",
      }),
    ).toEqual({
      amountFils: 0,
      allocation: { bookingPriceFils: 0, bookingServiceFeeFils: 0 },
    });
  });

  it("bases a cross-midnight booking's deadline on its original first shift", () => {
    // This purchased shift starts on 21 August in Iraq and ends on 22 August.
    expect(
      bookingCancellationRefundObligation({
        outcome: "customer_cancellation",
        firstStartsAt: "2099-08-21T23:00:00+03:00",
        evaluatedAt: "2099-08-19T23:00:00+03:00",
        captured,
      }),
    ).toEqual({
      amountFils: 128_450_000,
      allocation: {
        bookingPriceFils: 123_450_000,
        bookingServiceFeeFils: 5_000_000,
      },
    });
  });

  it.each([
    { firstStartsAt: "not-a-date", evaluatedAt: "2099-08-19T22:00:00.000Z" },
    { firstStartsAt: purchased.firstStartsAt, evaluatedAt: "not-a-date" },
    {
      firstStartsAt: "2099-08-22T01:00:00",
      evaluatedAt: "2099-08-19T22:00:00.000Z",
    },
    {
      firstStartsAt: purchased.firstStartsAt,
      evaluatedAt: "2099-08-19T22:00:00",
    },
  ])("rejects invalid or timezone-ambiguous timestamps: %j", (timestamps) => {
    expect(() =>
      bookingCancellationRefundObligation({
        ...purchased,
        ...timestamps,
        outcome: "customer_cancellation",
      }),
    ).toThrow("valid timestamps with an explicit timezone");
  });

  it("rejects an invalid captured amount even for a zero-refund outcome", () => {
    expect(() =>
      bookingCancellationRefundObligation({
        ...purchased,
        captured: { bookingPriceFils: 101, bookingServiceFeeFils: 5 },
        outcome: "customer_cancellation",
        evaluatedAt: "2099-08-22T05:00:00.000Z",
      }),
    ).toThrow("10% Marketplace Commission must be exact in fils");
  });
});
