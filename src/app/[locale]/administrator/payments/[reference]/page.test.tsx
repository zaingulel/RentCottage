import { render, screen } from "@testing-library/react";
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
vi.mock("next/navigation", () => ({
  notFound,
  unstable_rethrow: unstableRethrow,
}));

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
