import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
const { loadHistory } = vi.hoisted(() => ({ loadHistory: vi.fn() }));
vi.mock("@/booking-request/request-confirmed-booking-history", () => ({
  loadConfirmedBookingHistory: loadHistory,
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  unstable_rethrow: vi.fn(),
}));
vi.mock("@/access/request-account-context", () => ({
  requireRequestAccount: vi.fn().mockResolvedValue({
    status: "authenticated",
    context: { role: "customer", userId: "fixture" },
  }),
}));
vi.mock("@/access/actions", () => ({ signOutAccount: vi.fn() }));
import BookingHistoryPage from "./page";
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

it("labels retained cancelled bookings and links to their safe detail", async () => {
  loadHistory.mockResolvedValue([
    {
      receiptId: "82000000-0000-4000-8000-000000003502",
      bookingRequestReference: "RC-REQ-0000000000003501",
      bookingReference: "CONFIRMED-BOOKING-35",
      cottageName: "Preserved Cottage",
      confirmedAt: "2100-12-31T13:00:00Z",
      actorRole: "customer",
      cancelled: true,
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
});
