import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

import { PublicCottageProfileView } from "./public-cottage-profile";
import { PublicCustomerReviews } from "./public-customer-reviews";
import PublicCustomerReviewsPage from "../app/[locale]/cottages/[slug]/reviews/page";

const cottage = {
  slug: "garden-house",
  name: "Garden House",
  governorate: "Erbil",
  approximateLocation: "Shaqlawa",
  capacity: 5,
  amenities: ["pool"],
  mediaUrls: [],
  totalPriceIqd: 60000,
  bedrooms: 2,
  bathrooms: 1,
  description: "A quiet garden house.",
  houseRules: "No parties.",
  selectedInventory: [
    {
      serviceDay: "2026-09-22",
      kind: "shift" as const,
      position: 1,
      name: "Shift 1",
      startTime: "09:00",
      endTime: "15:00",
      priceIqd: 60000,
      available: true,
    },
    {
      serviceDay: "2026-09-23",
      kind: "full-day" as const,
      name: "Full day",
      startTime: "09:00",
      endTime: "23:00",
      priceIqd: null,
      available: false,
    },
  ],
};

describe("PublicCottageProfileView", () => {
  it("renders sidebar rows with weekday labels, markers and the total row", () => {
    render(
      <PublicCottageProfileView
        locale="en"
        result={{ status: "loaded", cottage }}
        queryString="guests=4"
      />,
    );
    const sidebar = screen.getByRole("complementary");
    const rows = within(sidebar).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Tue, Sep 22 · Shift 1");
    expect(rows[0]).toHaveTextContent("09:00–15:00");
    expect(within(rows[0]).getByText("IQD 60,000").tagName).toBe("B");
    expect(rows[1]).toHaveTextContent(
      "Wed, Sep 23 · Full-day bundle · Unavailable",
    );
    expect(rows[1]).toHaveTextContent("Price unavailable");
    expect(
      within(sidebar).getByText("Total price").nextElementSibling,
    ).toHaveTextContent("IQD 60,000");
    expect(
      within(sidebar).getByRole("link", { name: "Get exact quote" }),
    ).toHaveAttribute("href", "/en/request/garden-house?guests=4");
    expect(
      within(sidebar).getByRole("link", { name: "Message this cottage" }),
    ).toHaveAttribute("href", "/en/messages?cottage=garden-house&guests=4");
    expect(
      screen.getByRole("link", { name: "Read customer reviews" }),
    ).toHaveAttribute("href", "/en/cottages/garden-house/reviews");
    expect(
      screen.getByRole("link", { name: "Back to results" }),
    ).toHaveAttribute("href", "/en/results?guests=4");
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it.each([
    ["ar", "قراءة تقييمات العملاء"],
    ["ckb", "هەڵسەنگاندنی کڕیاران بخوێنەوە"],
  ] as const)("links to the dedicated reviews page in %s", (locale, label) => {
    render(
      <PublicCottageProfileView
        locale={locale}
        result={{ status: "loaded", cottage }}
        queryString=""
      />,
    );
    expect(screen.getByRole("link", { name: label })).toHaveAttribute(
      "href",
      `/${locale}/cottages/garden-house/reviews`,
    );
  });

  it("keeps the back link and alert when the cottage is unavailable", () => {
    render(
      <PublicCottageProfileView
        locale="ckb"
        result={{ status: "unavailable" }}
        queryString=""
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "ئێستا ناتوانرێت کۆتێجەکە باربکرێت.",
    );
    expect(
      screen.getByRole("link", { name: "گەڕانەوە بۆ ئەنجامەکان" }),
    ).toHaveAttribute("href", "/ckb/results?");
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});

describe("PublicCustomerReviews", () => {
  it("renders only the unchanged public projection and deterministic continuation", () => {
    render(
      <PublicCustomerReviews
        locale="ar"
        publicSlug="cottage-11111111111111111111111111111111"
        result={{
          status: "success",
          items: [
            {
              reviewId: "11111111-1111-4111-8111-111111111111",
              rating: 5,
              originalLanguage: "ckb",
              originalBody: "شوێنێکی ئارام و جوانە",
              submittedAt: "2026-09-21T12:00:00.000Z",
            },
          ],
          nextCursor: {
            submittedAt: "2026-09-21T12:00:00.000Z",
            reviewId: "11111111-1111-4111-8111-111111111111",
          },
        }}
      />,
    );

    const original = screen.getByText("شوێنێکی ئارام و جوانە");
    expect(original).toHaveAttribute("lang", "ckb");
    expect(original).toHaveAttribute("dir", "auto");
    expect(screen.getByText("عميل RentCottage")).toBeVisible();
    expect(
      screen.queryByText(/author|booking|moderation|11111111/i),
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: "التقييمات التالية" }),
    ).toHaveAttribute(
      "href",
      "/ar/cottages/cottage-11111111111111111111111111111111/reviews?beforeAt=2026-09-21T12%3A00%3A00.000Z&beforeId=11111111-1111-4111-8111-111111111111",
    );
  });

  it("keeps unavailable distinct from an empty successful page", () => {
    const { rerender } = render(
      <PublicCustomerReviews
        locale="en"
        publicSlug="cottage-11111111111111111111111111111111"
        result={{ status: "unavailable" }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Reviews are unavailable. Refresh and try again.",
    );
    expect(screen.queryByText("No reviews yet.")).toBeNull();

    rerender(
      <PublicCustomerReviews
        locale="en"
        publicSlug="cottage-11111111111111111111111111111111"
        result={{ status: "success", items: [], nextCursor: null }}
      />,
    );
    expect(screen.getByText("No reviews yet.")).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("PublicCustomerReviewsPage", () => {
  it("accepts an anonymous validated cursor and calls the fixed public reader", async () => {
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
      limit: 1,
    });
    expect(screen.getByText("No reviews yet.")).toBeVisible();
  });

  it("rejects a partial or extra pagination query", async () => {
    listPublic.mockClear();
    await expect(
      PublicCustomerReviewsPage({
        params: Promise.resolve({
          locale: "en",
          slug: "cottage-11111111111111111111111111111111",
        }),
        searchParams: Promise.resolve({ beforeAt: "2026-09-21T12:00:00.000Z" }),
      }),
    ).rejects.toThrow("not-found");
    expect(listPublic).not.toHaveBeenCalled();
  });
});
