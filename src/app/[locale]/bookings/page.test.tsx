import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnerBookingEarningsFacts } from "@/booking-request/owner-booking-earnings";
const { loadHistory, requireAccount } = vi.hoisted(() => ({
  loadHistory: vi.fn(),
  requireAccount: vi.fn(),
}));
vi.mock("@/booking-request/request-booking-history", () => ({
  loadBookingHistory: loadHistory,
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  unstable_rethrow: vi.fn(),
}));
vi.mock("@/access/request-account-context", () => ({
  requireRequestAccount: requireAccount,
}));
vi.mock("@/access/actions", () => ({ signOutAccount: vi.fn() }));
import BookingHistoryPage from "./page";

const ownerFacts: OwnerBookingEarningsFacts = {
  status: "captured",
  captured: { bookingPriceFils: 100_000_000, bookingServiceFeeFils: 5_000_000 },
  refunded: { bookingPriceFils: 0, bookingServiceFeeFils: 0 },
  reserved: { bookingPriceFils: 0, bookingServiceFeeFils: 0 },
  obligation: { bookingPriceFils: 0, bookingServiceFeeFils: 0 },
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
};
const ownerItem = (ownerEarnings: OwnerBookingEarningsFacts) => ({
  bookingRequestId: "60000000-0000-4000-8000-000000003501",
  receiptId: "82000000-0000-4000-8000-000000003502",
  bookingRequestReference: "RC-REQ-0000000000003501",
  bookingReference: "BOOKING-35",
  cottageName: "Preserved Cottage",
  createdAt: "2100-12-30T13:00:00Z",
  confirmedAt: "2100-12-31T13:00:00Z",
  firstStartsAt: "2101-01-01T05:00:00Z",
  lastEndsAt: "2101-01-01T09:00:00Z",
  actorRole: "cottage_owner" as const,
  status: "completed" as const,
  ownerEarnings,
});

beforeEach(() => {
  loadHistory.mockReset();
  requireAccount.mockResolvedValue({
    status: "authenticated",
    context: { role: "customer", userId: "fixture" },
  });
});
describe("Booking History failure", () => {
  it.each([
    ["en", "Account access is unavailable. Please try again."],
    ["ar", "الوصول إلى الحساب غير متاح. يرجى المحاولة مجددًا."],
    ["ckb", "دەستگەیشتن بە هەژمار بەردەست نییە. تکایە دووبارە هەوڵ بدەوە."],
  ])("explains an unavailable history in %s", async (locale, message) => {
    loadHistory.mockRejectedValue(new Error("private database diagnostic"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(
        await BookingHistoryPage({
          params: Promise.resolve({ locale }),
          searchParams: Promise.resolve({}),
        }),
      );
      expect(screen.getByRole("alert")).toHaveTextContent(message);
      expect(
        screen.queryByText("private database diagnostic"),
      ).not.toBeInTheDocument();
    } finally {
      errorLog.mockRestore();
    }
  });
});

describe("owner earnings history", () => {
  it("shows aggregate totals and per-booking earnings for an approved owner", async () => {
    requireAccount.mockResolvedValue({
      status: "authenticated",
      context: {
        role: "cottage_owner",
        userId: "owner",
        approvalState: "approved",
      },
    });
    loadHistory.mockResolvedValue([
      ownerItem(ownerFacts),
      {
        ...ownerItem({ status: "not-captured" }),
        bookingRequestId: "60000000-0000-4000-8000-000000003503",
      },
    ]);
    render(
      await BookingHistoryPage({
        params: Promise.resolve({ locale: "en" }),
        searchParams: Promise.resolve({ workspace: "owner" }),
      }),
    );
    const summary = screen.getByRole("region", { name: "Earnings summary" });
    expect(summary).toHaveTextContent("Expected unpaid payoutsIQD 90,000");
    expect(summary).toHaveTextContent("Paid payoutsIQD 0");
    expect(screen.getByText("Eligible for payout")).toBeVisible();
    expect(
      screen.getByText(
        "Payment has not been collected for this request, so it has no earnings yet.",
      ),
    ).toBeVisible();
    expect(loadHistory).toHaveBeenCalledWith("cottage_owner");
  });

  it("shows truthful zero totals for an empty approved-owner history", async () => {
    requireAccount.mockResolvedValue({
      status: "authenticated",
      context: {
        role: "cottage_owner",
        userId: "owner",
        approvalState: "approved",
      },
    });
    loadHistory.mockResolvedValue([]);
    render(
      await BookingHistoryPage({
        params: Promise.resolve({ locale: "ckb" }),
        searchParams: Promise.resolve({ workspace: "owner" }),
      }),
    );
    const summary = screen.getByRole("region", { name: "پوختەی داهات" });
    expect(summary).toHaveTextContent("IQD ٠");
    expect(screen.getByText("هێشتا هیچ داواکارییەکی حجز نییە.")).toBeVisible();
  });

  it("suppresses partial totals when one owner record is unavailable", async () => {
    requireAccount.mockResolvedValue({
      status: "authenticated",
      context: {
        role: "cottage_owner",
        userId: "owner",
        approvalState: "approved",
      },
    });
    loadHistory.mockResolvedValue([
      ownerItem(ownerFacts),
      {
        ...ownerItem({ status: "unavailable" }),
        bookingRequestId: "60000000-0000-4000-8000-000000003503",
      },
    ]);
    render(
      await BookingHistoryPage({
        params: Promise.resolve({ locale: "ar" }),
        searchParams: Promise.resolve({ workspace: "owner" }),
      }),
    );
    const summary = screen.getByRole("region", { name: "ملخص الأرباح" });
    expect(summary).toHaveTextContent("إجمالي الأرباح غير متاح");
    expect(summary).not.toHaveTextContent("IQD");
  });

  it("keeps the approved-owner gate in front of earnings", async () => {
    requireAccount.mockResolvedValue({
      status: "authenticated",
      context: { role: "customer", userId: "customer" },
    });
    render(
      await BookingHistoryPage({
        params: Promise.resolve({ locale: "en" }),
        searchParams: Promise.resolve({ workspace: "owner" }),
      }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This booking is not available to this account.",
    );
    expect(loadHistory).not.toHaveBeenCalled();
  });
});

it("labels retained cancelled bookings and links to their safe detail", async () => {
  loadHistory.mockResolvedValue([
    {
      bookingRequestId: "60000000-0000-4000-8000-000000003501",
      receiptId: "82000000-0000-4000-8000-000000003502",
      bookingRequestReference: "RC-REQ-0000000000003501",
      bookingReference: "CONFIRMED-BOOKING-35",
      cottageName: "Preserved Cottage",
      createdAt: "2100-12-30T13:00:00Z",
      confirmedAt: "2100-12-31T13:00:00Z",
      firstStartsAt: "2101-01-01T05:00:00Z",
      lastEndsAt: "2101-01-01T09:00:00Z",
      actorRole: "customer",
      status: "cancelled",
    },
  ]);
  render(
    await BookingHistoryPage({
      params: Promise.resolve({ locale: "en" }),
      searchParams: Promise.resolve({}),
    }),
  );
  expect(screen.getByText("Cancelled booking")).toBeVisible();
  expect(
    screen.getByRole("link", { name: /Preserved Cottage/ }),
  ).toHaveAttribute("href", "/en/booking-requests/RC-REQ-0000000000003501");
  expect(loadHistory).toHaveBeenCalledWith("customer");
});

it.each(["completed", "no_show", "incident_pending"])(
  "shows %s from the persisted lifecycle in booking history",
  async (status) => {
    loadHistory.mockResolvedValue([
      {
        bookingRequestId: "60000000-0000-4000-8000-000000003501",
        receiptId: "82000000-0000-4000-8000-000000003502",
        bookingRequestReference: "RC-REQ-0000000000003501",
        bookingReference: "BOOKING",
        cottageName: "Preserved Cottage",
        createdAt: "2100-12-30T13:00:00Z",
        confirmedAt: "2100-12-31T13:00:00Z",
        firstStartsAt: "2101-01-01T05:00:00Z",
        lastEndsAt: "2101-01-01T09:00:00Z",
        actorRole: "customer",
        status,
      },
    ]);
    render(
      await BookingHistoryPage({
        params: Promise.resolve({ locale: "en" }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(
      screen.getByText(
        status === "completed"
          ? "Completed booking"
          : status === "no_show"
            ? "No-show"
            : "Incident pending",
      ),
    ).toBeVisible();
  },
);
