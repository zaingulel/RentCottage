import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createReview,
  listAdministrator,
  notFound,
  redirect,
  resolveAccount,
  unstableRethrow,
} = vi.hoisted(() => ({
  createReview: vi.fn(),
  listAdministrator: vi.fn(),
  notFound: vi.fn(),
  redirect: vi.fn(),
  resolveAccount: vi.fn(),
  unstableRethrow: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound,
  redirect,
  unstable_rethrow: unstableRethrow,
}));
vi.mock("@/access/request-account-context", () => ({
  requireRequestAccount: resolveAccount,
  resolveRequestAccount: resolveAccount,
}));
vi.mock("@/customer-review/request-customer-review", () => ({
  createRequestCustomerReview: createReview,
}));

import AdministratorCustomerReviewsPage from "./page";

describe("AdministratorCustomerReviewsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createReview.mockResolvedValue({ listAdministrator });
  });

  it("redirects a signed-out request to dedicated administrator access with the exact queue destination", async () => {
    const signal = new Error("NEXT_REDIRECT");
    resolveAccount.mockResolvedValue({ status: "signed_out" });
    redirect.mockImplementation(() => {
      throw signal;
    });

    await expect(
      AdministratorCustomerReviewsPage({
        params: Promise.resolve({ locale: "en" }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toBe(signal);

    expect(redirect).toHaveBeenCalledWith(
      "/en/administrator/access?returnTo=%2Fen%2Fadministrator%2Freviews",
    );
    expect(createReview).not.toHaveBeenCalled();
    expect(unstableRethrow).not.toHaveBeenCalled();
  });

  it("renders unavailable when request account resolution is unavailable", async () => {
    resolveAccount.mockResolvedValue({ status: "unavailable" });

    render(
      await AdministratorCustomerReviewsPage({
        params: Promise.resolve({ locale: "en" }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Reviews are unavailable. Refresh and try again.",
    );
    expect(createReview).not.toHaveBeenCalled();
  });

  it.each(["customer", "cottage_owner"] as const)(
    "denies a %s account without reading the private queue",
    async (role) => {
      resolveAccount.mockResolvedValue({
        status: "authenticated",
        context:
          role === "customer"
            ? { userId: "customer-1", role }
            : { userId: "owner-1", role, approvalState: "approved" },
      });

      render(
        await AdministratorCustomerReviewsPage({
          params: Promise.resolve({ locale: "en" }),
          searchParams: Promise.resolve({}),
        }),
      );

      expect(
        screen.getByText(
          "Authenticator-verified administrator access is required.",
        ),
      ).toBeVisible();
      expect(createReview).not.toHaveBeenCalled();
    },
  );

  it("fails closed on an invalid cursor before resolving the account", async () => {
    const signal = new Error("NEXT_NOT_FOUND");
    notFound.mockImplementation(() => {
      throw signal;
    });

    await expect(
      AdministratorCustomerReviewsPage({
        params: Promise.resolve({ locale: "en" }),
        searchParams: Promise.resolve({ beforeAt: "invalid" }),
      }),
    ).rejects.toBe(signal);

    expect(resolveAccount).not.toHaveBeenCalled();
  });

  it.each([
    [{ foo: "1" }],
    [{ state: "hidden", foo: "1" }],
    [{ state: ["hidden", "unhidden"] }],
    [{ from: undefined }],
    [{ beforeAt: "2026-09-21T12:00:00.000Z" }],
    [{ beforeId: "11111111-1111-4111-8111-111111111111" }],
    [{ state: "hidden", beforeAt: "invalid", beforeId: "invalid" }],
  ])("fails closed on the unaccepted query %j", async (query) => {
    const signal = new Error("NEXT_NOT_FOUND");
    notFound.mockImplementation(() => {
      throw signal;
    });

    await expect(
      AdministratorCustomerReviewsPage({
        params: Promise.resolve({ locale: "en" }),
        searchParams: Promise.resolve(query),
      }),
    ).rejects.toBe(signal);

    expect(resolveAccount).not.toHaveBeenCalled();
    expect(listAdministrator).not.toHaveBeenCalled();
  });

  it.each([
    [
      {},
      {
        beforeAt: null,
        beforeId: null,
        state: null,
        from: null,
        through: null,
      },
    ],
    [
      { state: "hidden", from: "2026-09-01", through: "2026-09-30" },
      {
        beforeAt: null,
        beforeId: null,
        state: "hidden",
        from: "2026-09-01",
        through: "2026-09-30",
      },
    ],
    [
      { state: "", from: "", through: "" },
      {
        beforeAt: null,
        beforeId: null,
        state: null,
        from: null,
        through: null,
      },
    ],
    [
      {
        state: "unhidden",
        beforeAt: "2026-09-21T12:00:00.000Z",
        beforeId: "11111111-1111-4111-8111-111111111111",
      },
      {
        beforeAt: "2026-09-21T12:00:00.000Z",
        beforeId: "11111111-1111-4111-8111-111111111111",
        state: "unhidden",
        from: null,
        through: null,
      },
    ],
  ])("passes the accepted query %j to the reader", async (query, expected) => {
    resolveAccount.mockResolvedValue({
      status: "authenticated",
      context: { userId: "administrator-1", role: "platform_administrator" },
    });
    listAdministrator.mockResolvedValue({
      status: "success",
      items: [],
      nextCursor: null,
      total: 0,
      stateCounts: { unhidden: 0, hidden: 0 },
    });

    render(
      await AdministratorCustomerReviewsPage({
        params: Promise.resolve({ locale: "en" }),
        searchParams: Promise.resolve(query),
      }),
    );

    expect(listAdministrator).toHaveBeenCalledWith({ ...expected, limit: 20 });
    expect(screen.getByLabelText("Status")).toHaveValue(expected.state ?? "");
    expect(screen.getByLabelText("From date (Baghdad)")).toHaveValue(
      expected.from ?? "",
    );
  });

  it("shows the invalid-filter message beside the filters when the reader refuses a value", async () => {
    resolveAccount.mockResolvedValue({
      status: "authenticated",
      context: { userId: "administrator-1", role: "platform_administrator" },
    });
    listAdministrator.mockResolvedValue({ status: "invalid" });

    render(
      await AdministratorCustomerReviewsPage({
        params: Promise.resolve({ locale: "en" }),
        searchParams: Promise.resolve({ state: "bogus" }),
      }),
    );

    expect(listAdministrator).toHaveBeenCalledWith(
      expect.objectContaining({ state: "bogus" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "These filters are not valid. Check the dates and try again.",
    );
    expect(screen.getByLabelText("Status")).toBeVisible();
    expect(screen.queryByText(/Matching reviews/)).toBeNull();
  });

  it("renders unavailable when the administrator queue read fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    resolveAccount.mockResolvedValue({
      status: "authenticated",
      context: { userId: "administrator-1", role: "platform_administrator" },
    });
    listAdministrator.mockRejectedValue(new Error("database unavailable"));

    render(
      await AdministratorCustomerReviewsPage({
        params: Promise.resolve({ locale: "en" }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Reviews are unavailable. Refresh and try again.",
    );
  });

  it("requests a 20-review page and keeps SQL assurance decisive", async () => {
    resolveAccount.mockResolvedValue({
      status: "authenticated",
      context: {
        userId: "administrator-1",
        role: "platform_administrator",
      },
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
      state: null,
      from: null,
      through: null,
    });
    expect(resolveAccount).toHaveBeenCalledWith();
    expect(
      screen.getByText(
        "Authenticator-verified administrator access is required.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Complete administrator access" }),
    ).toHaveAttribute(
      "href",
      "/en/administrator/access?returnTo=%2Fen%2Fadministrator%2Freviews",
    );
  });
});
