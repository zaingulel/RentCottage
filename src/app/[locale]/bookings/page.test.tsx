import { cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listOwnerBookingRequestNotifications } from "@/booking-request/owner-booking-request-notifications";
import { ownerBookingRequestNotificationDisplay } from "@/booking-request/booking-request-display";
import { ownerDisplayFixtures } from "../../../../tests/fixtures/booking-request-display.fixtures";
import type { OwnerBookingEarningsFacts } from "@/booking-request/owner-booking-earnings";
const { loadHistory, loadNotifications, requireAccount } = vi.hoisted(() => ({
  loadHistory: vi.fn(),
  loadNotifications: vi.fn(),
  requireAccount: vi.fn(),
}));
vi.mock("@/booking-request/request-booking-history", () => ({
  loadBookingHistory: loadHistory,
}));
vi.mock(
  "@/booking-request/request-owner-booking-request-notifications",
  () => ({
    loadOwnerBookingRequestNotifications: loadNotifications,
  }),
);
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
  loadNotifications.mockReset().mockResolvedValue([]);
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
      expect(loadNotifications).not.toHaveBeenCalled();
      expect(
        screen.queryByText("private database diagnostic"),
      ).not.toBeInTheDocument();
    } finally {
      errorLog.mockRestore();
    }
  });
});

it("owner bookings retains records without earnings", async () => {
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
      bookingRequestReference: "RC-REQ-0000000000003503",
    },
    {
      ...ownerItem({ status: "unavailable" }),
      bookingRequestId: "60000000-0000-4000-8000-000000003504",
      bookingRequestReference: "RC-REQ-0000000000003504",
    },
  ]);
  const { container } = render(
    await BookingHistoryPage({
      params: Promise.resolve({ locale: "en" }),
      searchParams: Promise.resolve({ workspace: "owner" }),
    }),
  );
  expect(screen.queryByRole("region", { name: "Earnings summary" })).toBeNull();
  expect(
    screen.queryByRole("region", { name: "Earnings and payout" }),
  ).toBeNull();
  expect(
    screen
      .getAllByRole("link", { name: "Preserved Cottage" })
      .map((link) => link.getAttribute("href")),
  ).toEqual([
    "/en/owner/booking-requests/RC-REQ-0000000000003501",
    "/en/owner/booking-requests/RC-REQ-0000000000003503",
    "/en/owner/booking-requests/RC-REQ-0000000000003504",
  ]);
  expect(screen.getAllByText("BOOKING-35")).toHaveLength(3);
  expect(screen.getAllByText("Completed booking")).toHaveLength(3);
  expect(
    screen
      .getAllByRole("listitem")
      .every(
        (row) =>
          row.querySelector("time")?.getAttribute("datetime") ===
          "2101-01-01T05:00:00Z",
      ),
  ).toBe(true);
  expect(container.querySelector("main")?.firstElementChild).toBe(
    screen.getByRole("navigation", { name: "Owner Backoffice" }),
  );
  expect(screen.getByRole("link", { name: "Bookings" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.queryByRole("link", { name: "RentCottage home" })).toBeNull();
  expect(screen.getByRole("heading", { level: 1 })).toHaveAttribute(
    "id",
    "owner-bookings-heading",
  );
  expect(loadHistory).toHaveBeenCalledWith("cottage_owner");
});

describe("owner bookings access", () => {
  it("keeps the approved-owner gate in front of owner records", async () => {
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
    expect(loadNotifications).not.toHaveBeenCalled();
  });
});

it("shows a Customer with no bookings the empty state and one next action", async () => {
  loadHistory.mockResolvedValue([]);
  const { container } = render(
    await BookingHistoryPage({
      params: Promise.resolve({ locale: "en" }),
      searchParams: Promise.resolve({}),
    }),
  );
  expect(container.querySelector(".empty-state")).toHaveTextContent(
    "No booking requests yet.",
  );
  expect(
    screen.getByRole("link", { name: "Search available cottages" }),
  ).toHaveAttribute("href", "/en");
  expect(
    screen.getByRole("link", { name: "RentCottage home" }),
  ).toHaveAttribute("href", "/en");
  expect(
    screen.queryByRole("navigation", { name: "Owner Backoffice" }),
  ).not.toBeInTheDocument();
  expect(loadHistory).toHaveBeenCalledWith("customer");
  expect(loadNotifications).not.toHaveBeenCalled();
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

it("owner bookings keeps the authoritative waiting count and fails visibly if it is unavailable", async () => {
  requireAccount.mockResolvedValue({
    status: "authenticated",
    context: {
      role: "cottage_owner",
      userId: "owner",
      approvalState: "approved",
    },
  });
  loadHistory.mockResolvedValue([ownerItem(ownerFacts)]);
  const page = () =>
    BookingHistoryPage({
      params: Promise.resolve({ locale: "en" }),
      searchParams: Promise.resolve({ workspace: "owner" }),
    });
  const pending = {
    ...ownerDisplayFixtures["capture-processing"],
    status: "pending" as const,
  };
  loadNotifications.mockResolvedValue([
    pending,
    { ...pending, id: "00000000-0000-4000-8000-000000000002" },
    ownerDisplayFixtures["payment-required-open"],
  ]);
  render(await page());
  expect(
    screen.getByRole("link", {
      name: "Bookings Pending Booking Requests: 2",
    }),
  ).toHaveAttribute("href", "/en/bookings?workspace=owner");
  expect(
    screen.getByRole("link", {
      name: "Bookings Pending Booking Requests: 2",
    }),
  ).toHaveAttribute("aria-current", "page");
  expect(
    screen.getByRole("link", { name: "Preserved Cottage" }),
  ).toHaveAttribute(
    "href",
    "/en/owner/booking-requests/RC-REQ-0000000000003501",
  );
  expect(screen.queryByRole("region", { name: "Earnings summary" })).toBeNull();
  expect(screen.getByText("Completed booking")).toBeVisible();
  expect(loadNotifications).toHaveBeenCalledTimes(1);
  cleanup();

  loadNotifications.mockClear().mockResolvedValue([]);
  render(await page());
  expect(screen.getByRole("link", { name: "Bookings" })).toHaveAttribute(
    "href",
    "/en/bookings?workspace=owner",
  );
  expect(screen.getByRole("link", { name: "Preserved Cottage" })).toBeVisible();
  expect(loadNotifications).toHaveBeenCalledTimes(1);
  cleanup();

  const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    for (const outcome of ["undefined", "rejected", "malformed"]) {
      errorLog.mockClear();
      loadNotifications.mockClear();
      if (outcome === "undefined")
        loadNotifications.mockResolvedValue(undefined);
      else if (outcome === "rejected")
        loadNotifications.mockRejectedValue(
          new Error("private notification diagnostic"),
        );
      else {
        const rpc = vi
          .fn()
          .mockResolvedValue({ data: [{ status: "pending" }], error: null });
        const client = { rpc } as unknown as SupabaseClient;
        loadNotifications.mockImplementation(async () =>
          (await listOwnerBookingRequestNotifications(client)).map(
            ownerBookingRequestNotificationDisplay,
          ),
        );
      }
      render(await page());
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Account access is unavailable. Please try again.",
      );
      expect(screen.queryByRole("navigation")).toBeNull();
      expect(screen.queryByText(/IQD/)).toBeNull();
      expect(screen.queryByText("Preserved Cottage")).toBeNull();
      expect(screen.queryByText("private notification diagnostic")).toBeNull();
      expect(loadNotifications).toHaveBeenCalledTimes(1);
      expect(errorLog.mock.calls).toEqual(
        outcome === "undefined"
          ? []
          : [
              [
                "Booking History load failed",
                { code: "booking_history_failed" },
              ],
            ],
      );
      cleanup();
    }
  } finally {
    errorLog.mockRestore();
  }
});
