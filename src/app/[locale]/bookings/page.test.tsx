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
import BookingHistoryPage from "./page";
describe("Booking History failure", () => {
  it.each([
    ["en", "Booking History is unavailable. Please try again."],
    ["ar", "سجل الحجوزات غير متاح. يرجى المحاولة مرة أخرى."],
    ["ckb", "مێژووی حجزەکان بەردەست نییە. تکایە دووبارە هەوڵ بدەوە."],
  ])("explains an unavailable history in %s", async (locale, message) => {
    loadHistory.mockRejectedValue(new Error("private database diagnostic"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(await BookingHistoryPage({ params: Promise.resolve({ locale }) }));
      expect(screen.getByRole("alert")).toHaveTextContent(message);
      expect(
        screen.queryByText("private database diagnostic"),
      ).not.toBeInTheDocument();
    } finally {
      errorLog.mockRestore();
    }
  });
});
