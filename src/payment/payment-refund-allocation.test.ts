import { describe, expect, it } from "vitest";

import {
  exactMarketplaceCommission,
  refundAllocationTotal,
  refundCapacity,
  validateRefundAllocation,
} from "./payment-refund-allocation";

const captured = {
  bookingPriceFils: 123_450_000,
  bookingServiceFeeFils: 5_000_000,
};
const zero = { bookingPriceFils: 0, bookingServiceFeeFils: 0 };

describe("explicit payment refund allocation", () => {
  it("keeps the full obligation separate from successful refunds and pending reservations", () => {
    expect(
      refundCapacity({
        captured,
        refunded: {
          bookingPriceFils: 23_450_000,
          bookingServiceFeeFils: 2_000_000,
        },
        reserved: {
          bookingPriceFils: 40_000_000,
          bookingServiceFeeFils: 1_000_000,
        },
      }),
    ).toEqual({
      remaining: {
        bookingPriceFils: 100_000_000,
        bookingServiceFeeFils: 3_000_000,
      },
      available: {
        bookingPriceFils: 60_000_000,
        bookingServiceFeeFils: 2_000_000,
      },
    });
    expect(captured).toEqual({
      bookingPriceFils: 123_450_000,
      bookingServiceFeeFils: 5_000_000,
    });
  });

  it("still owes the full refund while an unknown full refund reserves all capacity", () => {
    expect(
      refundCapacity({ captured, refunded: zero, reserved: captured }),
    ).toEqual({
      remaining: {
        bookingPriceFils: 123_450_000,
        bookingServiceFeeFils: 5_000_000,
      },
      available: { bookingPriceFils: 0, bookingServiceFeeFils: 0 },
    });
  });

  it("has no outstanding amount after verified full return", () => {
    expect(
      refundCapacity({ captured, refunded: captured, reserved: zero }),
    ).toEqual({
      remaining: { bookingPriceFils: 0, bookingServiceFeeFils: 0 },
      available: { bookingPriceFils: 0, bookingServiceFeeFils: 0 },
    });
  });

  it("returns the explicit partial total and computes commission only on Booking Price", () => {
    expect(
      validateRefundAllocation(
        { bookingPriceFils: 23_450_000, bookingServiceFeeFils: 2_000_001 },
        captured,
      ),
    ).toBe(25_450_001);
    expect(exactMarketplaceCommission(100_000_000)).toBe(10_000_000);
    expect(refundAllocationTotal(captured)).toBe(128_450_000);
  });

  it.each([
    [
      { bookingPriceFils: 123_450_010, bookingServiceFeeFils: 0 },
      "Booking Price",
    ],
    [
      { bookingPriceFils: 0, bookingServiceFeeFils: 5_000_001 },
      "Booking Service Fee",
    ],
  ] as const)(
    "rejects an over-capacity allocation without moving money between components",
    (allocation, component) => {
      expect(() => validateRefundAllocation(allocation, captured)).toThrow(
        `exceeds the remaining ${component}`,
      );
      expect(() =>
        refundCapacity({ captured, refunded: allocation, reserved: zero }),
      ).toThrow(`exceeds the remaining ${component}`);
      expect(() =>
        refundCapacity({ captured, refunded: zero, reserved: allocation }),
      ).toThrow(`exceeds the remaining ${component}`);
    },
  );

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid component amount %s",
    (amount) => {
      expect(() =>
        refundAllocationTotal({
          bookingPriceFils: amount,
          bookingServiceFeeFils: 0,
        }),
      ).toThrow("non-negative safe integer fils");
      expect(() =>
        refundAllocationTotal({
          bookingPriceFils: 0,
          bookingServiceFeeFils: amount,
        }),
      ).toThrow("non-negative safe integer fils");
    },
  );

  it("rejects a sum outside safe integer fils", () => {
    expect(() =>
      refundAllocationTotal({
        bookingPriceFils: Number.MAX_SAFE_INTEGER,
        bookingServiceFeeFils: 1,
      }),
    ).toThrow("Customer Total must be safe integer fils");
  });

  it("rejects a zero refund but permits zero remaining capacity", () => {
    expect(() => validateRefundAllocation(zero, captured)).toThrow(
      "Refund must return a positive amount",
    );
  });

  it("rejects amounts that would require rounding the commission", () => {
    expect(() =>
      validateRefundAllocation(
        { bookingPriceFils: 1, bookingServiceFeeFils: 0 },
        captured,
      ),
    ).toThrow("10% Marketplace Commission must be exact in fils");
    expect(() => exactMarketplaceCommission(101)).toThrow(
      "10% Marketplace Commission must be exact in fils",
    );
  });
});
