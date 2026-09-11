import { describe, expect, it } from "vitest";
import {
  bookingFinancialPresentation,
  refundInputAllocation,
} from "./booking-financial-presentation";
const zero = { bookingPriceFils: 0, bookingServiceFeeFils: 0 };
const facts = {
  captured: { bookingPriceFils: 100000000, bookingServiceFeeFils: 5000000 },
  refunded: zero,
  obligation: zero,
  pending: false,
};
describe("truthful retained booking finances", () => {
  it("keeps approved pending refunds out of verified owner-share subtraction", () => {
    expect(
      bookingFinancialPresentation({ ...facts, pending: true }),
    ).toMatchObject({
      originalCommissionFils: 10000000,
      originalOwnerShareFils: 90000000,
      ownerShareAfterCompletedRefundsFils: 90000000,
      pending: true,
      fullRefundRequired: false,
    });
  });
  it("reduces share and exact commission only for completed price refunds", () => {
    expect(
      bookingFinancialPresentation({
        ...facts,
        refunded: { bookingPriceFils: 20000000, bookingServiceFeeFils: 0 },
      }),
    ).toMatchObject({
      originalOwnerShareFils: 90000000,
      ownerShareAfterCompletedRefundsFils: 72000000,
    });
  });
  it("does not reduce owner share for a service-fee-only return", () => {
    expect(
      bookingFinancialPresentation({
        ...facts,
        refunded: { bookingPriceFils: 0, bookingServiceFeeFils: 1000001 },
      }).ownerShareAfterCompletedRefundsFils,
    ).toBe(90000000);
  });
  it("preserves no-payout full cancellation policy before success or after provider failure", () => {
    expect(
      bookingFinancialPresentation({ ...facts, obligation: facts.captured }),
    ).toMatchObject({
      fullRefundRequired: true,
      ownerShareAfterCompletedRefundsFils: 90000000,
    });
  });
  it("does not apply a no-payout override to a late customer cancellation", () => {
    expect(bookingFinancialPresentation(facts).fullRefundRequired).toBe(false);
  });
  it("fails loudly on impossible returned allocation", () => {
    expect(() =>
      bookingFinancialPresentation({
        ...facts,
        refunded: { bookingPriceFils: 100000010, bookingServiceFeeFils: 0 },
      }),
    ).toThrow();
  });
  it("parses decimal IQD exactly and retains price commission increments and fee fils", () => {
    expect(refundInputAllocation("20000.01", "1.001")).toEqual({
      bookingPriceFils: 20000010,
      bookingServiceFeeFils: 1001,
    });
    expect(refundInputAllocation("٢٠٠٠٠٫٠١", "۱٫۰۰۱")).toEqual({
      bookingPriceFils: 20000010,
      bookingServiceFeeFils: 1001,
    });
  });
  it.each([
    ["1.001", "0"],
    ["1e4", "0"],
    ["1.0001", "0"],
    ["0", "0"],
    ["-1", "0"],
    ["9007199254741", "0"],
  ])("rejects inexact or invalid allocation %s/%s", (price, fee) => {
    expect(() => refundInputAllocation(price, fee)).toThrow();
  });
});
