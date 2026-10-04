import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import { PublicCottageProfileView } from "./public-cottage-profile";

const query = {
  from: "2026-09-22",
  to: "2026-09-23",
  guests: 4,
  selections: [],
  amenities: [],
};

const cottage = {
  slug: "garden-house",
  name: "Garden House",
  governorate: "Erbil",
  approximateLocation: "Shaqlawa",
  capacity: 5,
  amenities: ["pool"],
  mediaUrls: [],
  bedrooms: 2,
  bathrooms: 1,
  description: "A quiet garden house.",
  houseRules: "No parties.",
  inventory: [
    {
      serviceDay: "2026-09-22",
      kind: "shift" as const,
      position: 1,
      name: '<script>alert("period")</script>',
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
  it("renders explicit options with no implicit selection or aggregate and disabled onward actions", () => {
    render(
      <PublicCottageProfileView
        locale="en"
        result={{ status: "loaded", cottage }}
        query={{
          from: "2026-09-22",
          to: "2026-09-23",
          guests: 4,
          selections: [],
          amenities: [],
        }}
        queryString="from=2026-09-22&to=2026-09-23&guests=4"
      />,
    );
    const sidebar = screen.getByRole("complementary");
    const rows = within(sidebar).getAllByRole("listitem");
    expect(
      within(sidebar).getByRole("group", { name: "Tue, Sep 22" }),
    ).toBeVisible();
    expect(rows[0]).toHaveTextContent('<script>alert("period")</script>');
    expect(rows[0].querySelector("script")).toBeNull();
    expect(rows[0]).toHaveTextContent("09:00–15:00");
    expect(rows[0].querySelector("bdi")).toHaveAttribute("dir", "ltr");
    expect(within(rows[0]).getByText("IQD 60,000").tagName).toBe("B");
    expect(
      within(sidebar).getByRole("group", { name: "Wed, Sep 23" }),
    ).toBeVisible();
    expect(rows[1]).toHaveTextContent(
      "Full-day bundle09:00–23:00Price unavailableUnavailable",
    );
    expect(within(sidebar).queryByText("Total price")).toBeNull();
    expect(
      within(sidebar).getByRole("button", { name: "Get exact quote" }),
    ).toBeDisabled();
    expect(
      within(sidebar).getByRole("button", { name: "Message this cottage" }),
    ).toBeDisabled();
    expect(
      within(sidebar).getByRole("button", {
        name: '<script>alert("period")</script>',
      }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("link", { name: "Read customer reviews" }),
    ).toHaveAttribute("href", "/en/cottages/garden-house/reviews");
    expect(
      screen.getByRole("link", { name: "Back to results" }),
    ).toHaveAttribute(
      "href",
      "/en/results?from=2026-09-22&to=2026-09-23&guests=4",
    );
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it.each([
    [
      "ar",
      "قراءة تقييمات العملاء",
      "اختر فترة الحجز",
      "عرض السعر الدقيق",
      "السعر غير متاح",
      "IQD 60,000",
    ],
    [
      "ckb",
      "هەڵسەنگاندنی کڕیاران بخوێنەوە",
      "ماوەی حجزەکەت هەڵبژێرە",
      "پێشنیاری نرخی ورد",
      "نرخ بەردەست نییە",
      "IQD ٦٠٬٠٠٠",
    ],
  ] as const)(
    "links to the dedicated reviews page in %s",
    (locale, label, title, quote, noPrice, price) => {
      render(
        <PublicCottageProfileView
          locale={locale}
          query={query}
          result={{ status: "loaded", cottage }}
          queryString=""
        />,
      );
      expect(screen.getByRole("heading", { name: title })).toBeVisible();
      expect(screen.getByRole("button", { name: quote })).toBeDisabled();
      expect(screen.getByText(noPrice)).toBeVisible();
      expect(screen.getByText(price)).toBeVisible();
      expect(screen.getByRole("link", { name: label })).toHaveAttribute(
        "href",
        `/${locale}/cottages/garden-house/reviews`,
      );
    },
  );

  it("keeps the back link and alert when the cottage is unavailable", () => {
    render(
      <PublicCottageProfileView
        locale="ckb"
        result={{ status: "unavailable" }}
        query={null}
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
