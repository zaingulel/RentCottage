import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listPublic, notFound } = vi.hoisted(() => ({
  listPublic: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("not-found");
  }),
}));

vi.mock("next/navigation", () => ({ notFound, unstable_rethrow: vi.fn() }));
vi.mock("@/customer-review/request-customer-review", () => ({
  createRequestCustomerReview: vi.fn().mockResolvedValue({ listPublic }),
}));

import PublicCustomerReviewsPage from "./page";

describe("PublicCustomerReviewsPage", () => {
  beforeEach(() => vi.clearAllMocks());

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
});
