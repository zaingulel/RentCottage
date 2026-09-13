import { describe, expect, it } from "vitest";
import {
  ownerBookingEarnings,
  ownerBookingEarningsTotals,
  parseOwnerBookingEarningsFacts,
  type OwnerBookingEarningsFacts,
} from "./owner-booking-earnings";

const captured = {
  bookingPriceFils: 100_000_000,
  bookingServiceFeeFils: 5_000_000,
};
const zero = { bookingPriceFils: 0, bookingServiceFeeFils: 0 };
const facts = (
  change: Partial<OwnerBookingEarningsFacts> = {},
): OwnerBookingEarningsFacts => ({
  status: "captured",
  captured,
  refunded: zero,
  reserved: zero,
  obligation: zero,
  marketplaceCommissionRateBasisPoints: 1_000,
  marketplaceCommissionAmountFils: 10_000_000,
  refunds: [],
  maturity: {
    status: "completed",
    effectivePeriodEnd: "2101-01-01T12:00:00Z",
    assessedAt: "2101-01-01T12:00:01Z",
    reviewExpiresAt: "2101-01-15T12:00:00Z",
    reviewAvailable: true,
    payoutPrerequisiteAt: "2101-01-01T12:00:00Z",
    payoutPrerequisiteAvailable: true,
  },
  administratorHoldActive: false,
  disputes: [],
  settlement: null,
  recovery: { status: "unsettled" },
  ...change,
});

describe("owner booking earnings projection", () => {
  it("uses the independent IQD 100k oracle and keeps service fees outside commission and payout", () => {
    expect(ownerBookingEarnings(facts())).toMatchObject({
      status: "eligible",
      bookingPriceFils: 100_000_000,
      bookingServiceFeeFils: 5_000_000,
      originalMarketplaceCommissionFils: 10_000_000,
      completedBookingPriceRefundFils: 0,
      completedBookingServiceFeeRefundFils: 0,
      currentNetPayoutFils: 90_000_000,
      expectedUnpaidPayoutFils: 90_000_000,
      paidPayoutFils: 0,
    });
    expect(
      ownerBookingEarnings(
        facts({
          refunded: {
            bookingPriceFils: 20_000_000,
            bookingServiceFeeFils: 0,
          },
        }),
      ),
    ).toMatchObject({
      status: "eligible",
      currentMarketplaceCommissionFils: 8_000_000,
      expectedUnpaidPayoutFils: 72_000_000,
    });
    expect(
      ownerBookingEarnings(
        facts({
          refunded: {
            bookingPriceFils: 0,
            bookingServiceFeeFils: 5_000_000,
          },
        }),
      ),
    ).toMatchObject({
      currentMarketplaceCommissionFils: 10_000_000,
      expectedUnpaidPayoutFils: 90_000_000,
    });
  });

  it.each([
    ["administrator hold", { administratorHoldActive: true }, "blocked"],
    [
      "open dispute",
      { disputes: [{ state: "open" as const, outcome: null }] },
      "blocked",
    ],
    [
      "resolving partial award",
      {
        disputes: [
          {
            state: "resolving" as const,
            outcome: "partial_customer_award" as const,
          },
        ],
      },
      "blocked",
    ],
    [
      "requested refund",
      {
        reserved: { bookingPriceFils: 10_000_000, bookingServiceFeeFils: 0 },
        refunds: [
          {
            state: "requested" as const,
            allocation: {
              bookingPriceFils: 10_000_000,
              bookingServiceFeeFils: 0,
            },
          },
        ],
      },
      "blocked",
    ],
    [
      "failed refund",
      {
        refunds: [
          {
            state: "failed" as const,
            allocation: {
              bookingPriceFils: 10_000_000,
              bookingServiceFeeFils: 0,
            },
          },
        ],
      },
      "attention",
    ],
    [
      "not mature",
      {
        maturity: {
          status: "unavailable" as const,
          reviewAvailable: false as const,
          payoutPrerequisiteAvailable: false as const,
        },
      },
      "not-yet-eligible",
    ],
  ])("maps %s to %s", (_label, change, expected) => {
    expect(ownerBookingEarnings(facts(change)).status).toBe(expected);
  });

  it.each(["requested", "processing", "indeterminate"] as const)(
    "shows a matching %s settlement as pending",
    (state) => {
      expect(
        ownerBookingEarnings(
          facts({
            settlement: {
              amountFils: 90_000_000,
              state,
              retrySafe: false,
              receipt: null,
            },
          }),
        ).status,
      ).toBe("pending");
    },
  );

  it("puts a stale requested amount into attention before pending", () => {
    expect(
      ownerBookingEarnings(
        facts({
          refunded: {
            bookingPriceFils: 20_000_000,
            bookingServiceFeeFils: 0,
          },
          settlement: {
            amountFils: 90_000_000,
            state: "requested",
            retrySafe: false,
            receipt: null,
          },
        }),
      ),
    ).toMatchObject({
      status: "attention",
      currentNetPayoutFils: 72_000_000,
      expectedUnpaidPayoutFils: 72_000_000,
      causes: ["settlement-stale", "settlement-pending"],
    });
  });

  it.each(["failed", "not-executed"] as const)(
    "maps %s settlement evidence to attention regardless of retry safety",
    (state) => {
      expect(
        ownerBookingEarnings(
          facts({
            settlement: {
              amountFils: 90_000_000,
              state,
              retrySafe: true,
              receipt: null,
            },
          }),
        ).status,
      ).toBe("attention");
    },
  );

  it("keeps a valid paid receipt paid after a later refund and reports supplied recovery", () => {
    expect(
      ownerBookingEarnings(
        facts({
          refunded: {
            bookingPriceFils: 20_000_000,
            bookingServiceFeeFils: 0,
          },
          administratorHoldActive: true,
          settlement: {
            amountFils: 90_000_000,
            state: "succeeded",
            retrySafe: false,
            receipt: {
              paidFils: 90_000_000,
              recordedAt: "2101-01-02T12:00:00Z",
            },
          },
          recovery: {
            status: "paid",
            ownerEntitlementFils: 72_000_000,
            paidFils: 90_000_000,
            paidWhileBlocked: false,
            recoveryExposureFils: 18_000_000,
            recoveryBalanceFils: 18_000_000,
            automaticOwnerDebitFils: 0,
          },
        }),
      ),
    ).toMatchObject({
      status: "paid",
      expectedUnpaidPayoutFils: 0,
      paidPayoutFils: 90_000_000,
      recoveryBalanceFils: 18_000_000,
      recoveryExposureFils: 18_000_000,
      causes: ["administrator-hold", "recovery-required"],
    });
  });

  it("applies a mandatory Full Refund override to expected totals even when settlement needs attention", () => {
    expect(
      ownerBookingEarnings(
        facts({
          obligation: captured,
          settlement: {
            amountFils: 90_000_000,
            state: "failed",
            retrySafe: false,
            receipt: null,
          },
        }),
      ),
    ).toMatchObject({ status: "attention", expectedUnpaidPayoutFils: 0 });
  });

  it("fails closed on contradictory receipts and snapshot commission evidence", () => {
    expect(() =>
      ownerBookingEarnings(
        facts({
          marketplaceCommissionAmountFils: 9_000_000,
        }),
      ),
    ).toThrow();
    expect(() =>
      ownerBookingEarnings(
        facts({
          settlement: {
            amountFils: 90_000_000,
            state: "succeeded",
            retrySafe: false,
            receipt: null,
          },
          recovery: { status: "unsettled" },
        }),
      ),
    ).toThrow();
  });

  it("parses only the allowlisted boundary and strips private payout metadata", () => {
    const parsed = parseOwnerBookingEarningsFacts({
      ...facts(),
      commandId: "PRIVATE",
      actorUserId: "PRIVATE",
      reason: "PRIVATE",
      providerReference: "PRIVATE",
      observationId: "PRIVATE",
      incidents: [{ narrative: "PRIVATE" }],
    });
    expect(parsed).toEqual(facts());
  });

  it("makes totals unavailable instead of emitting a partial number", () => {
    const eligible = ownerBookingEarnings(facts());
    const paid = ownerBookingEarnings(
      facts({
        settlement: {
          amountFils: 90_000_000,
          state: "succeeded",
          retrySafe: false,
          receipt: {
            paidFils: 90_000_000,
            recordedAt: "2101-01-02T12:00:00Z",
          },
        },
        recovery: {
          status: "paid",
          ownerEntitlementFils: 90_000_000,
          paidFils: 90_000_000,
          paidWhileBlocked: false,
          recoveryExposureFils: 0,
          recoveryBalanceFils: 0,
          automaticOwnerDebitFils: 0,
        },
      }),
    );
    expect(
      ownerBookingEarningsTotals([eligible, paid, { status: "not-captured" }]),
    ).toEqual({
      status: "available",
      expectedUnpaidPayoutFils: 90_000_000,
      paidPayoutFils: 90_000_000,
    });
    expect(
      ownerBookingEarningsTotals([eligible, { status: "unavailable" }]),
    ).toEqual({ status: "unavailable" });
    expect(ownerBookingEarningsTotals([])).toEqual({
      status: "available",
      expectedUnpaidPayoutFils: 0,
      paidPayoutFils: 0,
    });
  });
});
