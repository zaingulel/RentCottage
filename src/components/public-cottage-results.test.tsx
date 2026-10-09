import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PublicCottageResults } from "./public-cottage-results";

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
  inventory: [
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

describe("PublicCottageResults", () => {
  it("renders individual price rows and a button-styled action", () => {
    render(
      <PublicCottageResults
        locale="en"
        result={{ status: "loaded", cottages: [cottage], nextAfter: null }}
        query={query}
        continued={false}
        queryString="guests=4"
      />,
    );
    const card = screen.getByRole("article");
    expect(within(card).queryByText("total")).toBeNull();
    expect(within(card).getByRole("heading", { name: "Sep 22" })).toBeVisible();
    const rows = within(card).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Shift 109:00–15:00IQD 60,000Available");
    expect(within(rows[0]).getByText("IQD 60,000").tagName).toBe("B");
    expect(rows[1]).toHaveTextContent(
      "Full-day bundle09:00–23:00Price unavailableUnavailable",
    );
    expect(within(rows[1]).getByText("Price unavailable")).toBeVisible();
    const view = within(card).getByRole("link", { name: "View cottage" });
    expect(view).toHaveAttribute("href", "/en/cottages/garden-house?guests=4");
    expect(view).toHaveClass("action-link", "action-secondary", "action-full");
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it.each([
    ["ar", "22 أيلول", "متاح", "السعر غير متاح", "IQD 60,000"],
    ["ckb", "٢٢ی ئەیلوول", "بەردەستە", "نرخ بەردەست نییە", "IQD ٦٠٬٠٠٠"],
  ] as const)(
    "formats Service Days and labels in %s",
    (locale, day, available, noPrice, price) => {
      render(
        <PublicCottageResults
          locale={locale}
          result={{ status: "loaded", cottages: [cottage], nextAfter: null }}
          query={query}
          continued={false}
          queryString=""
        />,
      );
      expect(screen.getByRole("heading", { name: day })).toBeVisible();
      expect(screen.getByText(available)).toBeVisible();
      expect(screen.getByText(noPrice)).toBeVisible();
      expect(
        within(screen.getAllByRole("listitem")[0]).getByText(price),
      ).toBeVisible();
    },
  );

  it("shows the from price with its fee note in every launch language", () => {
    for (const [locale, label, price, note] of [
      [
        "en",
        "From",
        "IQD 60,000",
        "Lowest price for one available shift on your dates, excluding the Booking Service Fee.",
      ],
      [
        "ar",
        "ابتداءً من",
        "IQD 60,000",
        "أقل سعر لمناوبة واحدة متاحة في تواريخك، دون احتساب رسوم خدمة الحجز.",
      ],
      [
        "ckb",
        "دەستپێک لە",
        "IQD ٦٠٬٠٠٠",
        "کەمترین نرخ بۆ یەک شیفتی بەردەست لە ڕۆژەکانی تۆ، بەبێ کرێی خزمەتگوزاریی حجز.",
      ],
    ] as const) {
      const { unmount } = render(
        <PublicCottageResults
          locale={locale}
          result={{ status: "loaded", cottages: [cottage], nextAfter: null }}
          query={query}
          continued={false}
          queryString=""
        />,
      );
      const fromLine = screen.getByText(
        (_, element) =>
          element?.tagName === "P" &&
          element.textContent === `${label} ${price}`,
      );
      expect(fromLine).toHaveClass("result-from-price");
      expect(within(fromLine).getByText(price).tagName).toBe("B");
      expect(screen.getByText(note)).toBeVisible();
      unmount();
    }
  });

  it("shows the price unavailable wording instead of a from price when no available shift is priced", () => {
    const unpriced = {
      ...cottage,
      inventory: [
        { ...cottage.inventory[0], priceIqd: 60000, available: false },
        {
          ...cottage.inventory[1],
          serviceDay: "2026-09-22",
          priceIqd: 110000,
          available: true,
        },
      ],
    };
    render(
      <PublicCottageResults
        locale="en"
        result={{ status: "loaded", cottages: [unpriced], nextAfter: null }}
        query={query}
        continued={false}
        queryString=""
      />,
    );
    const card = screen.getByRole("article");
    const fromLine = within(card).getByText("Price unavailable");
    expect(fromLine.tagName).toBe("P");
    expect(fromLine).toHaveClass("result-from-price");
    expect(within(card).queryByText(/From/)).toBeNull();
    expect(within(card).queryByText(/Lowest price/)).toBeNull();
    expect(card).not.toHaveTextContent(/IQD 0\b/);
  });
  it("shows every individually priced option and partial availability without an aggregate", () => {
    const query = {
      from: "2026-09-22",
      to: "2026-09-23",
      guests: 4,
      amenities: [],
      selections: [
        {
          serviceDay: "2026-09-22",
          kind: "shift" as const,
          position: 1 as const,
        },
      ],
    };
    const result = {
      ...cottage,
      inventory: [
        {
          serviceDay: "2026-09-22",
          kind: "shift" as const,
          position: 1,
          name: '<img src=x onerror="alert(1)">',
          startTime: "09:00",
          endTime: "15:00",
          priceIqd: 60000,
          available: true,
        },
        {
          serviceDay: "2026-09-22",
          kind: "shift" as const,
          position: 2,
          name: "Evening",
          startTime: "18:00",
          endTime: "23:00",
          priceIqd: 80000,
          available: false,
        },
        {
          serviceDay: "2026-09-22",
          kind: "full-day" as const,
          name: "Full day",
          startTime: "09:00",
          endTime: "23:00",
          priceIqd: 110000,
          available: false,
        },
        {
          serviceDay: "2026-09-23",
          kind: "shift" as const,
          position: 1,
          name: "Morning",
          startTime: "09:00",
          endTime: "15:00",
          priceIqd: 65000,
          available: true,
        },
        {
          serviceDay: "2026-09-23",
          kind: "shift" as const,
          position: 2,
          name: "Evening",
          startTime: "18:00",
          endTime: "23:00",
          priceIqd: 90000,
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
    const queryString =
      "from=2026-09-22&to=2026-09-23&selection=2026-09-22%3Ashift%3A1&guests=4";
    render(
      <PublicCottageResults
        locale="en"
        result={{ status: "loaded", cottages: [result], nextAfter: null }}
        query={query}
        continued={false}
        queryString={queryString}
      />,
    );
    expect(screen.getAllByRole("article")).toHaveLength(1);
    const first = screen.getByRole("region", { name: "Sep 22" });
    const second = screen.getByRole("region", { name: "Sep 23" });
    expect(within(first).getAllByRole("listitem")).toHaveLength(3);
    expect(within(second).getAllByRole("listitem")).toHaveLength(3);
    const morning = within(first).getAllByRole("listitem")[0];
    expect(morning).toHaveTextContent('<img src=x onerror="alert(1)">');
    expect(morning.querySelector("img")).toBeNull();
    expect(morning).toHaveTextContent("09:00–15:00");
    expect(morning.querySelector("bdi")).toHaveAttribute("dir", "ltr");
    expect(morning).toHaveTextContent("IQD 60,000");
    expect(morning).toHaveTextContent("Available");
    expect(morning).toHaveTextContent("Selected filter");
    expect(within(first).getAllByRole("listitem")[1]).toHaveTextContent(
      "Evening18:00–23:00IQD 80,000Unavailable",
    );
    expect(within(second).getAllByRole("listitem")[2]).toHaveTextContent(
      "Price unavailable",
    );
    expect(
      screen.getByText(
        "Prices are per option. The exact quote includes the Booking Service Fee.",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/total|IQD 125,000/i)).toBeNull();
    expect(screen.getByRole("link", { name: "View cottage" })).toHaveAttribute(
      "href",
      "/en/cottages/garden-house?" + queryString,
    );
  });

  it("offers the next and first results with the search preserved in every launch language", () => {
    const after = "cottage-0123456789abcdef0123456789abcdef";
    const search = "from=2026-09-22&to=2026-09-23&guests=4";
    for (const [locale, label, next, first] of [
      ["en", "Results pages", "Next results", "Back to first results"],
      ["ar", "صفحات النتائج", "النتائج التالية", "العودة إلى أول النتائج"],
      [
        "ckb",
        "لاپەڕەکانی ئەنجام",
        "ئەنجامەکانی دواتر",
        "گەڕانەوە بۆ یەکەم ئەنجامەکان",
      ],
    ] as const) {
      const { unmount } = render(
        <PublicCottageResults
          locale={locale}
          result={{ status: "loaded", cottages: [cottage], nextAfter: after }}
          query={query}
          queryString={search}
          continued
        />,
      );
      const paging = screen.getByRole("navigation", { name: label });
      expect(paging).toHaveClass("results-paging");
      const links = within(paging).getAllByRole("link");
      expect(links.map((link) => link.textContent)).toEqual([first, next]);
      expect(links[0]).toHaveAttribute("href", `/${locale}/results?${search}`);
      expect(links[1]).toHaveAttribute(
        "href",
        `/${locale}/results?${search}&after=${after}`,
      );
      for (const link of links) {
        expect(link).toHaveClass("action-secondary", "action-content");
      }
      expect(
        screen
          .getAllByRole("link")
          .map((link) => link.getAttribute("href"))
          .filter((href) => href?.includes("/cottages/")),
      ).toEqual([`/${locale}/cottages/garden-house?${search}`]);
      unmount();
    }

    const firstPage = render(
      <PublicCottageResults
        locale="en"
        result={{ status: "loaded", cottages: [cottage], nextAfter: after }}
        query={query}
        queryString={search}
        continued={false}
      />,
    );
    expect(
      within(screen.getByRole("navigation")).getAllByRole("link"),
    ).toHaveLength(1);
    expect(
      screen.getByRole("link", { name: "Next results" }),
    ).toBeInTheDocument();
    firstPage.unmount();

    render(
      <PublicCottageResults
        locale="en"
        result={{ status: "loaded", cottages: [cottage], nextAfter: null }}
        query={query}
        queryString={search}
        continued
      />,
    );
    expect(
      within(screen.getByRole("navigation")).getAllByRole("link"),
    ).toHaveLength(1);
    expect(
      screen.getByRole("link", { name: "Back to first results" }),
    ).toHaveAttribute("href", `/en/results?${search}`);
  });

  it("says when a continued page has nothing further", () => {
    const search = "from=2026-09-22&to=2026-09-23&guests=4";
    for (const [locale, pastEnd, empty, first] of [
      [
        "en",
        "There are no more cottages for this search.",
        "No cottage matches every requested Service Day and selected filter.",
        "Back to first results",
      ],
      [
        "ar",
        "لا توجد بيوت أخرى لهذا البحث.",
        "لا يوجد بيت يطابق كل يوم مطلوب وجميع المرشحات المحددة.",
        "العودة إلى أول النتائج",
      ],
      [
        "ckb",
        "هیچ کۆتێجێکی تر بۆ ئەم گەڕانە نییە.",
        "هیچ کۆتێجێک لەگەڵ هەموو ڕۆژە داواکراوەکان و پاڵاوتە دیاریکراوەکان ناگونجێت.",
        "گەڕانەوە بۆ یەکەم ئەنجامەکان",
      ],
    ] as const) {
      const { unmount } = render(
        <PublicCottageResults
          locale={locale}
          result={{ status: "loaded", cottages: [], nextAfter: null }}
          query={query}
          queryString={search}
          continued
        />,
      );
      expect(screen.getByText(pastEnd)).toHaveClass("empty-results");
      expect(screen.queryByText(empty)).toBeNull();
      expect(screen.getByRole("link", { name: first })).toHaveAttribute(
        "href",
        `/${locale}/results?${search}`,
      );
      unmount();
    }

    render(
      <PublicCottageResults
        locale="en"
        result={{ status: "loaded", cottages: [], nextAfter: null }}
        query={query}
        queryString={search}
        continued={false}
      />,
    );
    expect(
      screen.getByText(
        "No cottage matches every requested Service Day and selected filter.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});
