import { cleanup, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listBookingHistory } from "@/booking-request/booking-history";
import type { OwnerBookingEarningsFacts } from "@/booking-request/owner-booking-earnings";
const { loadHistory, requireAccount } = vi.hoisted(() => ({
  loadHistory: vi.fn(),
  requireAccount: vi.fn(),
}));
vi.mock("@/booking-request/request-booking-history", () => ({
  loadBookingHistory: loadHistory,
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("not found");
  }),
  unstable_rethrow: vi.fn(),
}));
vi.mock("@/access/request-account-context", () => ({
  requireRequestAccount: requireAccount,
}));
vi.mock("@/access/actions", () => ({ signOutAccount: vi.fn() }));
import OwnerEarningsPage from "./page";

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

const approved = {
  role: "cottage_owner",
  userId: "owner",
  approvalState: "approved",
};
const page = (locale = "en") =>
  OwnerEarningsPage({ params: Promise.resolve({ locale }) });
beforeEach(() => {
  loadHistory.mockReset().mockResolvedValue([ownerItem(ownerFacts)]);
  requireAccount
    .mockReset()
    .mockResolvedValue({ status: "authenticated", context: approved });
});

it("Earnings permits only approved owners and binds the owner reader", async () => {
  for (const [locale, title, destination] of [
    ["en", "Earnings", "/en/owner/earnings"],
    ["ar", "الأرباح", "/ar/owner/earnings"],
    ["ckb", "داهات", "/ckb/owner/earnings"],
  ]) {
    render(await page(locale));
    expect(
      screen.getByRole("heading", { level: 1, name: title }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Preserved Cottage" }),
    ).toHaveAttribute(
      "href",
      `/${locale}/owner/booking-requests/RC-REQ-0000000000003501`,
    );
    expect(requireAccount).toHaveBeenLastCalledWith(locale, destination);
    expect(loadHistory).toHaveBeenLastCalledWith("cottage_owner");
    cleanup();
  }
  for (const account of [
    { status: "unavailable" },
    { status: "authenticated", context: null },
    { status: "authenticated", context: { role: "customer" } },
    { status: "authenticated", context: { role: "platform_administrator" } },
    ...["prospective", "suspended"].map((approvalState) => ({
      status: "authenticated",
      context: { ...approved, approvalState },
    })),
  ]) {
    loadHistory.mockClear();
    requireAccount.mockResolvedValue(account);
    render(await page());
    expect(screen.getByRole("alert")).toHaveTextContent(
      account.status === "unavailable"
        ? "Account access is unavailable. Please try again."
        : "This booking is not available to this account.",
    );
    expect(loadHistory).not.toHaveBeenCalled();
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByText("Preserved Cottage")).toBeNull();
    cleanup();
  }
  requireAccount.mockClear();
  await expect(page("invalid")).rejects.toThrow("not found");
  expect(requireAccount).not.toHaveBeenCalled();
});

it("Earnings preserves figures and fails visibly on invalid input", async () => {
  for (const [locale, summaryTitle, expected, paid, empty, manage] of [
    [
      "en",
      "Earnings summary",
      "IQD 90,000",
      "IQD 0",
      "No booking requests yet.",
      "Manage my cottages",
    ],
    [
      "ar",
      "ملخص الأرباح",
      "IQD 90,000",
      "IQD 0",
      "لا توجد طلبات حجز بعد.",
      "إدارة أكواخي",
    ],
    [
      "ckb",
      "پوختەی داهات",
      "IQD ٩٠٬٠٠٠",
      "IQD ٠",
      "هێشتا هیچ داواکارییەکی حجز نییە.",
      "بەڕێوەبردنی کۆتێجەکانم",
    ],
  ]) {
    loadHistory.mockResolvedValue([
      ownerItem(ownerFacts),
      {
        ...ownerItem({ status: "not-captured" }),
        bookingRequestId: "60000000-0000-4000-8000-000000003503",
      },
    ]);
    render(await page(locale));
    const summary = screen.getByRole("region", { name: summaryTitle });
    expect(summary.querySelectorAll("dd")[0]).toHaveTextContent(expected);
    expect(summary.querySelectorAll("dd")[1]).toHaveTextContent(paid);
    expect(
      screen.getAllByRole("link", { name: "Preserved Cottage" }),
    ).toHaveLength(2);
    if (locale === "en") {
      expect(screen.getByText("Eligible for payout")).toBeVisible();
      expect(
        screen.getByText(
          "Payment has not been collected for this request, so it has no earnings yet.",
        ),
      ).toBeVisible();
    }
    cleanup();
    loadHistory.mockResolvedValue([]);
    render(await page(locale));
    const emptySummary = screen.getByRole("region", { name: summaryTitle });
    expect(emptySummary.querySelectorAll("dd")).toHaveLength(2);
    for (const amount of emptySummary.querySelectorAll("dd"))
      expect(amount).toHaveTextContent(paid);
    expect(screen.getByText(empty)).toBeVisible();
    expect(
      within(screen.getByText(empty).parentElement!).getByRole("link", {
        name: manage,
      }),
    ).toHaveAttribute("href", `/${locale}/owner/cottages`);
    cleanup();
  }
  loadHistory.mockResolvedValue([
    ownerItem(ownerFacts),
    {
      ...ownerItem({ status: "unavailable" }),
      bookingRequestId: "60000000-0000-4000-8000-000000003503",
    },
  ]);
  render(await page("ar"));
  const partial = screen.getByRole("region", { name: "ملخص الأرباح" });
  expect(partial).toHaveTextContent("إجمالي الأرباح غير متاح");
  expect(partial).not.toHaveTextContent("IQD");
  cleanup();

  const rpc = vi.fn();
  const client = { rpc } as unknown as SupabaseClient;
  loadHistory.mockImplementation((actorRole) =>
    listBookingHistory(client, actorRole),
  );
  rpc.mockResolvedValue({
    data: [ownerItem({ status: "captured" } as OwnerBookingEarningsFacts)],
    error: null,
  });
  render(await page());
  expect(
    screen.getByRole("region", { name: "Earnings and payout" }),
  ).toHaveTextContent(
    "Earnings are temporarily unavailable for this booking. No amount is shown until the record can be verified.",
  );
  expect(
    screen.getByRole("region", { name: "Earnings summary" }),
  ).not.toHaveTextContent("IQD");
  expect(rpc).toHaveBeenCalledWith("list_booking_history", {
    target_actor_role: "cottage_owner",
  });
  cleanup();
  const hostile = '<img onerror="private()" src="x">';
  rpc.mockResolvedValue({
    data: [{ ...ownerItem(ownerFacts), cottageName: hostile }],
    error: null,
  });
  const { container } = render(await page());
  expect(screen.getByRole("link", { name: hostile })).toBeVisible();
  expect(container.querySelector("img")).toBeNull();
  cleanup();

  const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    for (const invalid of [
      { ...ownerItem(ownerFacts), bookingRequestId: "invalid" },
      { ...ownerItem(ownerFacts), actorRole: "customer" },
    ]) {
      rpc.mockResolvedValue({ data: [invalid], error: null });
      render(await page());
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Account access is unavailable. Please try again.",
      );
      cleanup();
    }
    for (const outcome of ["undefined", "read-error", "projection-error"]) {
      if (outcome === "undefined") loadHistory.mockResolvedValue(undefined);
      else if (outcome === "read-error")
        loadHistory.mockRejectedValue(new Error("private database diagnostic"));
      else
        loadHistory.mockResolvedValue([
          ownerItem({ ...ownerFacts, marketplaceCommissionAmountFils: 1 }),
        ]);
      render(await page());
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Account access is unavailable. Please try again.",
      );
      expect(screen.queryByText("private database diagnostic")).toBeNull();
      expect(screen.queryByRole("navigation")).toBeNull();
      cleanup();
    }
    expect(errorLog.mock.calls).toEqual(
      Array.from({ length: 4 }, () => [
        "Owner Earnings load failed",
        { code: "owner_earnings_failed" },
      ]),
    );
  } finally {
    errorLog.mockRestore();
  }
});
