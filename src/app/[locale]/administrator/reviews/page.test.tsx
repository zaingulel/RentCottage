import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listAdministrator, requireAccount } = vi.hoisted(() => ({
  listAdministrator: vi.fn(),
  requireAccount: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  unstable_rethrow: vi.fn(),
}));
vi.mock("@/access/request-account-context", () => ({
  requireRequestAccount: requireAccount,
}));
vi.mock("@/customer-review/request-customer-review", () => ({
  createRequestCustomerReview: vi.fn().mockResolvedValue({ listAdministrator }),
}));

import AdministratorCustomerReviewsPage from "./page";

describe("AdministratorCustomerReviewsPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requests a 20-review page and keeps SQL assurance decisive", async () => {
    requireAccount.mockResolvedValue({
      status: "authenticated",
      context: { role: "platform_administrator" },
    });
    listAdministrator.mockResolvedValue({ status: "access-required" });
    render(
      await AdministratorCustomerReviewsPage({
        params: Promise.resolve({ locale: "en" }),
        searchParams: Promise.resolve({
          beforeAt: "2026-09-21T12:00:00.000Z",
          beforeId: "11111111-1111-4111-8111-111111111111",
        }),
      }),
    );
    expect(listAdministrator).toHaveBeenCalledWith({
      beforeAt: "2026-09-21T12:00:00.000Z",
      beforeId: "11111111-1111-4111-8111-111111111111",
      limit: 20,
    });
    expect(
      screen.getByText(
        "Authenticator-verified administrator access is required.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Complete administrator access" }),
    ).toHaveAttribute("href", "/en/administrator/access");
  });
});
