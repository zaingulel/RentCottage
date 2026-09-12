import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { confirmed, financial, refresh, request } = vi.hoisted(() => ({
  confirmed: vi.fn(),
  financial: vi.fn(),
  refresh: vi.fn(),
  request: vi.fn(),
}));
vi.mock("@/access/request-account-context", () => ({
  requireRequestAccount: vi.fn().mockResolvedValue({ status: "authenticated" }),
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  unstable_rethrow: vi.fn(),
  useRouter: () => ({ refresh }),
}));
vi.mock("@/booking-request/lifecycle-actions", () => ({
  actOnBookingRequest: vi.fn(),
}));
vi.mock("@/booking-request/request-confirmed-booking-access", () => ({
  loadConfirmedBookingAccess: confirmed,
}));
vi.mock("@/booking-request/request-booking-financial-view", () => ({
  loadBookingFinancialView: financial,
}));
vi.mock(
  "@/booking-request/request-owner-booking-request-notifications",
  () => ({
    loadOwnerBookingRequest: request,
  }),
);
vi.mock("@/components/confirmed-booking-details", () => ({
  ConfirmedBookingDetails: () => <h1>Confirmed booking</h1>,
}));
vi.mock("@/components/booking-financial-details", () => ({
  BookingFinancialDetails: () => <h2>Cancellation and refunds</h2>,
}));
vi.mock("@/components/account-access-recovery", () => ({
  AccountAccessRecovery: () => <div role="alert">Access recovery</div>,
}));
import Page from "./page";
import { ownerDisplayFixtures } from "../../../../../../tests/fixtures/booking-request-display.fixtures";
const params = (locale: string) =>
  Promise.resolve({ locale, reference: "RC-REQ-AAAAAAAAAAAAAAAA" });
beforeEach(() => {
  vi.clearAllMocks();
  confirmed.mockResolvedValue({ access: { actorRole: "cottage_owner" } });
  financial.mockResolvedValue({
    cancellation: null,
    lifecycle: { status: "confirmed" },
  });
  request.mockResolvedValue(null);
});
afterEach(() => vi.useRealTimers());
it.each([
  ["en", "Confirmed booking is unavailable"],
  ["ar", "الحجز المؤكد غير متاح"],
  ["ckb", "حجزی پشتڕاستکراو بەردەست نییە"],
])(
  "shows financial-load failure and a recovery link in %s",
  async (locale, message) => {
    financial.mockRejectedValue(new Error("financial database unavailable"));
    render(await Page({ params: params(locale) }));
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("link", { name: "RentCottage" })).toHaveAttribute(
      "href",
      `/${locale}/owner/cottages`,
    );
    expect(
      screen.queryByRole("heading", { name: "Confirmed booking" }),
    ).not.toBeInTheDocument();
  },
);
it("keeps successful private owner details and refund information together", async () => {
  render(await Page({ params: params("en") }));
  expect(
    screen.getByRole("heading", { name: "Confirmed booking" }),
  ).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "Cancellation and refunds" }),
  ).toBeVisible();
  expect(financial).toHaveBeenCalledWith(
    "RC-REQ-AAAAAAAAAAAAAAAA",
    "cottage_owner",
  );
});
it("retains cancellation history without reopening private access", async () => {
  confirmed.mockResolvedValue(null);
  financial.mockResolvedValue({ cancellation: {} });
  render(await Page({ params: params("en") }));
  expect(
    screen.getByRole("heading", { name: "Cancellation and refunds" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "Confirmed booking" }),
  ).not.toBeInTheDocument();
});
it("opens an authorised unpaid owner request from complete history", async () => {
  confirmed.mockResolvedValue(null);
  request.mockResolvedValue(ownerDisplayFixtures["capture-processing"]);
  render(await Page({ params: params("en") }));
  expect(
    screen.getByRole("article", { name: "RC-REQ-AAAAAAAAAAAAAAAA" }),
  ).toBeVisible();
  expect(request).toHaveBeenCalledWith("RC-REQ-AAAAAAAAAAAAAAAA");
  expect(
    screen.queryByRole("heading", { name: "Confirmed booking" }),
  ).not.toBeInTheDocument();
});
it("replaces an unpaid request with its authoritative payment status", async () => {
  vi.useFakeTimers();
  confirmed.mockResolvedValue(null);
  request
    .mockResolvedValueOnce(ownerDisplayFixtures["capture-processing"])
    .mockResolvedValueOnce(ownerDisplayFixtures["payment-required-open"]);
  const view = render(await Page({ params: params("en") }));
  expect(screen.getByRole("status")).toHaveTextContent(
    "Payment confirmation pending",
  );
  vi.advanceTimersToNextTimer();
  expect(refresh).toHaveBeenCalledOnce();
  view.rerender(await Page({ params: params("en") }));
  expect(screen.getByRole("status")).toHaveTextContent(
    "The Customer’s automatic payment failed",
  );
});
it("keeps participant role isolation", async () => {
  confirmed.mockResolvedValue({ access: { actorRole: "customer" } });
  render(await Page({ params: params("en") }));
  expect(screen.getByRole("alert")).toHaveTextContent("Access recovery");
  expect(screen.queryByRole("heading")).not.toBeInTheDocument();
});
