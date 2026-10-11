import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listPublic, notFound, resolveAccount } = vi.hoisted(() => ({
  listPublic: vi.fn(),
  resolveAccount: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("not-found");
  }),
}));

vi.mock("next/navigation", () => ({ notFound, unstable_rethrow: vi.fn() }));
vi.mock("@/access/request-account-context", () => ({
  resolveRequestAccount: resolveAccount,
}));
vi.mock("@/customer-review/actions", () => ({
  translateCustomerReview: vi.fn(),
  reportCustomerReviewTranslation: vi.fn(),
}));
vi.mock("@/customer-review/request-customer-review", () => ({
  createRequestCustomerReview: vi.fn().mockResolvedValue({ listPublic }),
}));

import PublicCustomerReviewsPage from "./page";

describe("PublicCustomerReviewsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAccount.mockResolvedValue({ status: "signed_out" });
  });

  it("requests a 20-review page from an anonymous validated cursor", async () => {
    listPublic.mockResolvedValue({
      status: "success",
      items: [],
      nextCursor: null,
    });
    render(
      await PublicCustomerReviewsPage({
        params: Promise.resolve({
          locale: "en",
          slug: "cottage-11111111111111111111111111111111",
        }),
        searchParams: Promise.resolve({
          beforeAt: "2026-09-21T12:00:00.000Z",
          beforeId: "11111111-1111-4111-8111-111111111111",
        }),
      }),
    );
    expect(listPublic).toHaveBeenCalledWith({
      publicSlug: "cottage-11111111111111111111111111111111",
      beforeAt: "2026-09-21T12:00:00.000Z",
      beforeId: "11111111-1111-4111-8111-111111111111",
      limit: 20,
    });
    expect(screen.getByText("No reviews yet.")).toBeVisible();
  });

  it("rejects a partial or extra pagination query", async () => {
    await expect(
      PublicCustomerReviewsPage({
        params: Promise.resolve({
          locale: "en",
          slug: "cottage-11111111111111111111111111111111",
        }),
        searchParams: Promise.resolve({
          beforeAt: "2026-09-21T12:00:00.000Z",
        }),
      }),
    ).rejects.toThrow("not-found");
    expect(listPublic).not.toHaveBeenCalled();
  });

  const slug = "cottage-11111111111111111111111111111111";
  const arabicReview = {
    reviewId: "11111111-1111-4111-8111-111111111111",
    rating: 5,
    originalLanguage: "ar",
    originalBody: "مكان هادئ",
    submittedAt: "2026-09-21T12:00:00.000Z",
    ownerReply: null,
    translations: [],
  };

  async function renderPage(items: readonly unknown[] = [arabicReview]) {
    listPublic.mockResolvedValue({
      status: "success",
      items,
      nextCursor: null,
    });
    render(
      await PublicCustomerReviewsPage({
        params: Promise.resolve({ locale: "en", slug }),
        searchParams: Promise.resolve({}),
      }),
    );
  }

  it("sends a signed-out reader to sign in from the cottage page and draws no translation control", async () => {
    await renderPage();

    expect(
      screen.getByRole("link", {
        name: "Sign in to translate or report a translation",
      }),
    ).toHaveAttribute(
      "href",
      `/en/access?returnTo=${encodeURIComponent(`/en/cottages/${slug}`)}`,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it.each([
    ["a Customer", { userId: "u1", role: "customer" }],
    [
      "a Cottage Owner",
      { userId: "u2", role: "cottage_owner", approvalState: "approved" },
    ],
  ])("offers Translate to %s", async (_name, context) => {
    resolveAccount.mockResolvedValue({ status: "authenticated", context });
    await renderPage();

    expect(screen.getByRole("button", { name: "Translate" })).toBeVisible();
    expect(screen.queryByRole("link", { name: /Sign in/ })).toBeNull();
  });

  it.each([
    [
      "a Platform Administrator",
      {
        status: "authenticated",
        context: { userId: "u3", role: "platform_administrator" },
      },
    ],
    [
      "an authenticated account with no context",
      { status: "authenticated", context: undefined },
    ],
    ["an unavailable account", { status: "unavailable" }],
  ])(
    "offers no translation control and no sign-in link to %s",
    async (_name, account) => {
      resolveAccount.mockResolvedValue(account);
      await renderPage();

      expect(screen.getByText("مكان هادئ")).toBeVisible();
      expect(screen.queryByRole("button")).toBeNull();
      expect(screen.queryByRole("link", { name: /Sign in/ })).toBeNull();
    },
  );
});
