import { render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const { load, notFound, unstableRethrow } = vi.hoisted(() => ({
  load: vi.fn(),
  notFound: vi.fn(),
  unstableRethrow: vi.fn(),
}));
vi.mock("@/booking-request/request-booking-financial-view", () => ({
  loadBookingFinancialView: vi.fn().mockResolvedValue(null),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/booking-request/request-administrator-payment-history", () => ({
  loadAdministratorPaymentHistory: load,
}));
vi.mock("@/components/administrator-payment-history", () => ({
  AdministratorPaymentHistoryView: () => null,
}));
vi.mock("next/navigation", () => ({
  notFound,
  unstable_rethrow: unstableRethrow,
}));

import { loadBookingFinancialView } from "@/booking-request/request-booking-financial-view";
import AdministratorPaymentHistoryPage from "./page";

const params = Promise.resolve({
  locale: "en",
  reference: "RC-REQ-0000000000000137",
});

it("renders AAL1 as access required with the existing MFA path", async () => {
  load.mockResolvedValue({ status: "access_required" });
  render(await AdministratorPaymentHistoryPage({ params }));
  expect(screen.getByText(/assurance level 2/i)).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Complete administrator access" }),
  ).toHaveAttribute("href", "/en/administrator/access");
});

it("renders operational failure distinctly from access required", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  load.mockRejectedValue(new Error("provider unavailable"));
  render(await AdministratorPaymentHistoryPage({ params }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "temporarily unavailable",
  );
  expect(
    screen.queryByRole("link", { name: "Complete administrator access" }),
  ).not.toBeInTheDocument();
});

it("uses the framework not-found boundary for an unknown reference", async () => {
  load.mockResolvedValue({ status: "not_found" });
  await AdministratorPaymentHistoryPage({ params });
  expect(notFound).toHaveBeenCalledOnce();
});

it("shows the Platform administration navigation on a payment history with its section marked", async () => {
  load.mockResolvedValue({ status: "ready", history: {} });
  render(await AdministratorPaymentHistoryPage({ params }));
  const section = within(
    screen.getByRole("navigation", { name: "Platform administration" }),
  ).getByRole("link", { name: "Payment support history" });
  expect(section).toHaveAttribute("href", "/en/administrator/payments");
  expect(section).toHaveAttribute("aria-current", "true");
  expect(
    screen.queryByRole("link", { name: "New lookup" }),
  ).not.toBeInTheDocument();
});

it("says the financial details are unavailable when the financial view resolves to nothing", async () => {
  vi.mocked(loadBookingFinancialView).mockResolvedValueOnce(null);
  load.mockResolvedValue({ status: "ready", history: {} });
  render(await AdministratorPaymentHistoryPage({ params }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Cancellation and refund details are temporarily unavailable.",
  );
});
