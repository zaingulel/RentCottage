import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { OwnerBookingEarnings } from "@/booking-request/owner-booking-earnings";
import {
  OwnerBookingEarningsDetails,
  OwnerBookingEarningsSummary,
} from "./owner-booking-earnings";

const earnings: OwnerBookingEarnings = {
  status: "blocked",
  bookingPriceFils: 100_000_000,
  bookingServiceFeeFils: 5_000_000,
  originalMarketplaceCommissionFils: 10_000_000,
  currentMarketplaceCommissionFils: 8_000_000,
  completedBookingPriceRefundFils: 20_000_000,
  completedBookingServiceFeeRefundFils: 1_000_000,
  pendingBookingPriceRefundFils: 10_000_000,
  pendingBookingServiceFeeRefundFils: 500_000,
  currentNetPayoutFils: 72_000_000,
  expectedUnpaidPayoutFils: 72_000_000,
  paidPayoutFils: 0,
  recoveryExposureFils: 0,
  recoveryBalanceFils: 0,
  paidWhileBlocked: false,
  paidAt: null,
  causes: ["administrator-hold", "refund-pending"],
};

describe("Owner Booking Earnings summary", () => {
  it("shows exact aggregate unpaid and paid totals", () => {
    render(
      <OwnerBookingEarningsSummary
        locale="en"
        totals={{
          status: "available",
          expectedUnpaidPayoutFils: 72_000_001,
          paidPayoutFils: 90_000_000,
        }}
      />,
    );
    const summary = screen.getByRole("region", { name: "Earnings summary" });
    expect(summary).toHaveTextContent("Expected unpaid payoutsIQD 72,000.001");
    expect(summary).toHaveTextContent("Paid payoutsIQD 90,000");
  });

  it("suppresses partial totals when any booking is unavailable", () => {
    render(
      <OwnerBookingEarningsSummary
        locale="en"
        totals={{ status: "unavailable" }}
      />,
    );
    const summary = screen.getByRole("region", { name: "Earnings summary" });
    expect(summary).toHaveTextContent(
      "Earnings totals are unavailable. Check the booking records below for details.",
    );
    expect(summary).not.toHaveTextContent("IQD");
  });
});

describe("Owner Booking Earnings details", () => {
  it("keeps service fees, current net, expected unpaid, and causes distinct", () => {
    render(<OwnerBookingEarningsDetails locale="en" earnings={earnings} />);
    const details = screen.getByRole("region", { name: "Earnings and payout" });
    expect(details).toHaveTextContent("Booking PriceIQD 100,000");
    expect(details).toHaveTextContent("Booking Service FeeIQD 5,000");
    expect(details).toHaveTextContent(
      "Original Marketplace Commission (10%)IQD 10,000",
    );
    expect(details).toHaveTextContent(
      "Completed Booking Price refundsIQD 20,000",
    );
    expect(details).toHaveTextContent(
      "Completed Booking Service Fee refundsIQD 1,000",
    );
    expect(details).toHaveTextContent(
      "Pending Booking Price refundsIQD 10,000",
    );
    expect(details).toHaveTextContent(
      "Pending Booking Service Fee refundsIQD 500",
    );
    expect(details).toHaveTextContent("Current net payoutIQD 72,000");
    expect(details).toHaveTextContent("Expected unpaid payoutIQD 72,000");
    expect(details).toHaveTextContent("Payout blocked");
    expect(details).toHaveTextContent("An administrator hold is active.");
    expect(details).toHaveTextContent(
      "A refund is pending; these earnings may change.",
    );
  });

  it("shows immutable paid evidence separately from current recovery", () => {
    render(
      <OwnerBookingEarningsDetails
        locale="ar"
        earnings={{
          ...earnings,
          status: "paid",
          currentNetPayoutFils: 72_000_000,
          expectedUnpaidPayoutFils: 0,
          paidPayoutFils: 90_000_000,
          recoveryExposureFils: 90_000_000,
          recoveryBalanceFils: 18_000_000,
          paidWhileBlocked: true,
          paidAt: "2101-01-02T06:00:00Z",
          causes: ["paid-while-blocked", "recovery-required"],
        }}
      />,
    );
    const details = screen.getByRole("region", { name: "الأرباح والدفعة" });
    expect(details).toHaveTextContent("صافي الدفعة الحاليIQD 72,000");
    expect(details).toHaveTextContent("الدفعة المسجلةIQD 90,000");
    expect(details).toHaveTextContent("رصيد الاسترداد الحاليIQD 18,000");
    expect(details).toHaveTextContent("التعرض المسجل للاستردادIQD 90,000");
    expect(details).toHaveTextContent("دُفعت التسوية أثناء وجود حظر.");
    expect(details).toHaveTextContent(
      "لا يخصم سجل الاسترداد هذا مبلغاً من المالك تلقائياً.",
    );
    expect(within(details).getByText(/02.*01.*2101/)).toBeInTheDocument();
  });

  it.each([
    [
      "en",
      "Payment has not been collected for this request, so it has no earnings yet.",
    ],
    [
      "ckb",
      "پارەی ئەم داواکارییە هێشتا کۆنەکراوەتەوە، بۆیە هێشتا داهاتی نییە.",
    ],
  ] as const)(
    "explains uncaptured earnings without inventing zero in %s",
    (locale, copy) => {
      render(
        <OwnerBookingEarningsDetails
          locale={locale}
          earnings={{ status: "not-captured" }}
        />,
      );
      const details = screen.getByRole("region");
      expect(details).toHaveTextContent(copy);
      expect(details).not.toHaveTextContent("IQD");
    },
  );
});
