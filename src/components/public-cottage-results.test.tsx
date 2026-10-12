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
  it("marks cross-midnight and 24-hour Full-day endings in every locale", () => {
    const cases = [
      [cottage.inventory[0], "09:00–15:00", false],
      [
        { ...cottage.inventory[0], startTime: "17:00", endTime: "02:00" },
        "17:00–02:00",
        true,
      ],
      [cottage.inventory[1], "09:00–23:00", false],
      [{ ...cottage.inventory[1], endTime: "02:00" }, "09:00–02:00", true],
      [{ ...cottage.inventory[1], endTime: "09:00" }, "09:00–09:00", true],
      [{ ...cottage.inventory[0], endTime: "09:00" }, "09:00–09:00", false],
    ] as const;
    for (const [locale, nextDay] of [
      ["en", "next day"],
      ["ar", "اليوم التالي"],
      ["ckb", "ڕۆژی دواتر"],
    ] as const) {
      for (const [unit, clock, endsNextDay] of cases) {
        const { unmount } = render(
          <PublicCottageResults
            locale={locale}
            result={{
              status: "loaded",
              cottages: [{ ...cottage, inventory: [unit] }],
              nextAfter: null,
            }}
            query={query}
            after={null}
            queryString=""
          />,
        );
        const row = screen.getByRole("listitem");
        const times = within(row).getByText(clock);
        expect(times).toBeVisible();
        expect(times.tagName).toBe("BDI");
        expect(times).toHaveAttribute("dir", "ltr");
        expect(times.textContent).toBe(clock);
        if (endsNextDay) {
          expect(row).toHaveTextContent(`${clock} ${nextDay}`);
        } else {
          expect(row).not.toHaveTextContent(nextDay);
        }
        unmount();
      }
    }
  });

  it("renders individual price rows and a button-styled action", () => {
    render(
      <PublicCottageResults
        locale="en"
        result={{ status: "loaded", cottages: [cottage], nextAfter: null }}
        query={query}
        after={null}
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
    expect(view).toHaveAttribute(
      "href",
      "/en/cottages/garden-house?from=2026-09-22&to=2026-09-23&guests=4",
    );
    expect(view).toHaveClass("action-link", "action-primary", "action-content");
    expect(card.querySelector(".result-image")).toBeInTheDocument();
    expect(within(card).queryByRole("img")).toBeNull();
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
          after={null}
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
          after={null}
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
        after={null}
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
        after={null}
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
          after={after}
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
      ).toEqual([`/${locale}/cottages/garden-house?${search}&after=${after}`]);
      unmount();
    }

    const firstPage = render(
      <PublicCottageResults
        locale="en"
        result={{ status: "loaded", cottages: [cottage], nextAfter: after }}
        query={query}
        queryString={search}
        after={null}
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
        after={after}
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
    const after = "cottage-0123456789abcdef0123456789abcdef";
    const search = "from=2026-09-22&to=2026-09-23&guests=4";
    for (const [locale, pastEnd, empty, first, changeSearch] of [
      [
        "en",
        "There are no more cottages for this search.",
        "No cottage matches every requested Service Day and selected filter.",
        "Back to first results",
        "Change search",
      ],
      [
        "ar",
        "لا توجد بيوت أخرى لهذا البحث.",
        "لا يوجد بيت يطابق كل يوم مطلوب وجميع المرشحات المحددة.",
        "العودة إلى أول النتائج",
        "غيّر البحث",
      ],
      [
        "ckb",
        "هیچ کۆتێجێکی تر بۆ ئەم گەڕانە نییە.",
        "هیچ کۆتێجێک لەگەڵ هەموو ڕۆژە داواکراوەکان و پاڵاوتە دیاریکراوەکان ناگونجێت.",
        "گەڕانەوە بۆ یەکەم ئەنجامەکان",
        "گەڕان بگۆڕە",
      ],
    ] as const) {
      const { unmount } = render(
        <PublicCottageResults
          locale={locale}
          result={{ status: "loaded", cottages: [], nextAfter: null }}
          query={query}
          queryString={search}
          after={after}
        />,
      );
      const emptyState = screen.getByText(pastEnd).closest(".empty-state");
      expect(emptyState).not.toBeNull();
      expect(
        within(emptyState as HTMLElement).getByRole("link", {
          name: changeSearch,
        }),
      ).toHaveAttribute("href", `/${locale}`);
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
        after={null}
      />,
    );
    expect(
      screen.getByText(
        "No cottage matches every requested Service Day and selected filter.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("offers Change search from the empty and past-the-end states in every launch language", () => {
    for (const [locale, changeSearch] of [
      ["en", "Change search"],
      ["ar", "غيّر البحث"],
      ["ckb", "گەڕان بگۆڕە"],
    ] as const) {
      for (const after of [null, "cottage-0123456789abcdef0123456789abcdef"]) {
        const { container, unmount } = render(
          <PublicCottageResults
            locale={locale}
            result={{ status: "loaded", cottages: [], nextAfter: null }}
            query={query}
            queryString="from=2026-09-22&to=2026-09-23&guests=4"
            after={after}
          />,
        );
        const emptyState = container.querySelector(".empty-state");
        expect(emptyState).not.toBeNull();
        expect(emptyState!.querySelectorAll("p")).toHaveLength(1);
        const link = within(emptyState as HTMLElement).getByRole("link");
        expect(link).toHaveTextContent(changeSearch);
        expect(link).toHaveAttribute("href", `/${locale}`);
        expect(link).toHaveClass("action-secondary", "action-content");
        unmount();
      }
    }
  });

  describe("search summary and match explanation", () => {
    const fullQuery = {
      from: "2026-09-22",
      to: "2026-09-23",
      guests: 4,
      selections: [
        {
          serviceDay: "2026-09-22",
          kind: "shift" as const,
          position: 1 as const,
        },
        { serviceDay: "2026-09-23", kind: "full-day" as const },
      ],
      governorate: "Erbil",
      area: "Shaqlawa",
      amenities: ["pool", "wifi"],
    };
    const facts = (list: Element) =>
      [...list.querySelectorAll(":scope > div")].map((fact) => {
        const lines = [...fact.querySelectorAll("dd > span")];
        return [
          fact.querySelector("dt")?.textContent,
          ...(lines.length > 0
            ? lines.map((line) => line.textContent)
            : [fact.querySelector("dd")?.textContent]),
        ];
      });
    const summaryFacts = (name: string) => {
      const summary = screen.getByRole("region", { name });
      expect(summary).toHaveClass("search-summary");
      const list = summary.querySelector("dl.fact-list");
      expect(list).not.toBeNull();
      return facts(list!);
    };

    it("summarises the submitted search in every launch language", () => {
      for (const [locale, title, expected] of [
        [
          "en",
          "Your search",
          [
            ["From Service Day", "Tue, Sep 22"],
            ["To Service Day", "Wed, Sep 23"],
            ["Guests", "4"],
            [
              "Booking Period filters",
              "Tue, Sep 22: Shift 1",
              "Wed, Sep 23: Full-day bundle",
            ],
            ["Governorate", "Erbil"],
            ["Approximate area", "Shaqlawa"],
            ["Amenities", "Pool", "Wi-Fi"],
          ],
        ],
        [
          "ar",
          "بحثك",
          [
            ["من تاريخ", "الثلاثاء، 22 أيلول"],
            ["إلى تاريخ", "الأربعاء، 23 أيلول"],
            ["عدد الضيوف", "4"],
            [
              "مرشحات فترة الحجز",
              "الثلاثاء، 22 أيلول: الفترة 1",
              "الأربعاء، 23 أيلول: اليوم الكامل",
            ],
            ["المحافظة", "Erbil"],
            ["المنطقة التقريبية", "Shaqlawa"],
            ["المرافق", "مسبح", "واي فاي"],
          ],
        ],
        [
          "ckb",
          "گەڕانەکەت",
          [
            ["لە بەرواری", "سێشەممە، ٢٢ی ئەیلوول"],
            ["تا بەرواری", "چوارشەممە، ٢٣ی ئەیلوول"],
            ["ژمارەی میوان", "4"],
            [
              "پاڵاوتەکانی ماوەی حجز",
              "سێشەممە، ٢٢ی ئەیلوول: شیفت 1",
              "چوارشەممە، ٢٣ی ئەیلوول: پاکێجی ڕۆژی تەواو",
            ],
            ["پارێزگا", "Erbil"],
            ["ناوچەی نزیکەیی", "Shaqlawa"],
            ["خزمەتگوزارییەکان", "مەلەوانگە", "وایفای"],
          ],
        ],
      ] as const) {
        const { unmount } = render(
          <PublicCottageResults
            locale={locale}
            result={{ status: "loaded", cottages: [cottage], nextAfter: null }}
            query={fullQuery}
            after={null}
            queryString=""
          />,
        );
        expect(summaryFacts(title)).toEqual(expected);
        const summary = screen.getByRole("region", { name: title });
        const heading = within(summary).getByRole("heading", {
          level: 2,
          name: title,
        });
        expect(heading).toHaveClass("section-title");
        expect(summary.previousElementSibling).toHaveClass("page-heading");
        expect(summary.nextElementSibling).toHaveClass("results-list");
        expect(within(summary).getByText("Erbil").tagName).toBe("BDI");
        expect(within(summary).getByText("Shaqlawa").tagName).toBe("BDI");
        expect(
          within(summary)
            .getAllByText(expected[0][1])
            .map((date) => date.tagName),
        ).toEqual(["DD", "BDI"]);
        unmount();
      }
    });

    it("shows the search summary in the empty, past-the-end and load-failure states", () => {
      for (const [status, after, state] of [
        [
          "loaded",
          null,
          "No cottage matches every requested Service Day and selected filter.",
        ],
        [
          "loaded",
          "cottage-0123456789abcdef0123456789abcdef",
          "There are no more cottages for this search.",
        ],
        [
          "unavailable",
          null,
          "Cottages could not be loaded right now. Please try again.",
        ],
      ] as const) {
        const { unmount } = render(
          <PublicCottageResults
            locale="en"
            result={
              status === "loaded"
                ? { status, cottages: [], nextAfter: null }
                : { status }
            }
            query={fullQuery}
            after={after}
            queryString=""
          />,
        );
        expect(screen.getByText(state)).toBeVisible();
        expect(summaryFacts("Your search")).toEqual([
          ["From Service Day", "Tue, Sep 22"],
          ["To Service Day", "Wed, Sep 23"],
          ["Guests", "4"],
          [
            "Booking Period filters",
            "Tue, Sep 22: Shift 1",
            "Wed, Sep 23: Full-day bundle",
          ],
          ["Governorate", "Erbil"],
          ["Approximate area", "Shaqlawa"],
          ["Amenities", "Pool", "Wi-Fi"],
        ]);
        unmount();
      }
    });

    it("leaves out the rows the search did not supply", () => {
      render(
        <PublicCottageResults
          locale="en"
          result={{ status: "loaded", cottages: [cottage], nextAfter: null }}
          query={query}
          after={null}
          queryString=""
        />,
      );
      expect(summaryFacts("Your search")).toEqual([
        ["From Service Day", "Tue, Sep 22"],
        ["To Service Day", "Wed, Sep 23"],
        ["Guests", "4"],
      ]);
      expect(
        within(screen.getByRole("article")).queryByText(
          "Amenities you searched for",
        ),
      ).toBeNull();
    });

    it("explains a match by capacity and only the searched amenities the cottage has", () => {
      const searched = { ...query, amenities: ["pool", "parking", "wifi"] };
      const matching = render(
        <PublicCottageResults
          locale="en"
          result={{
            status: "loaded",
            cottages: [
              {
                ...cottage,
                name: "Hill House",
                amenities: ["garden", "wifi", "pool"],
              },
            ],
            nextAfter: null,
          }}
          query={searched}
          after={null}
          queryString=""
        />,
      );
      const card = screen.getByRole("article");
      const match = card.querySelector(".result-content > dl.fact-list");
      expect(match).not.toBeNull();
      expect(facts(match!)).toEqual([
        ["Capacity", "5 guests"],
        ["Amenities you searched for", "Pool", "Wi-Fi"],
      ]);
      expect(match!.previousElementSibling).toHaveTextContent(
        "Approximate location: Shaqlawa, Erbil",
      );
      expect(card).not.toHaveTextContent("Garden");
      expect(card).not.toHaveTextContent("Parking");
      expect(card.querySelectorAll("li")).toHaveLength(
        cottage.inventory.length,
      );
      matching.unmount();

      render(
        <PublicCottageResults
          locale="en"
          result={{
            status: "loaded",
            cottages: [{ ...cottage, amenities: ["garden"] }],
            nextAfter: null,
          }}
          query={searched}
          after={null}
          queryString=""
        />,
      );
      expect(
        facts(
          screen
            .getByRole("article")
            .querySelector(".result-content > dl.fact-list")!,
        ),
      ).toEqual([["Capacity", "5 guests"]]);
    });

    it("never shows a word for a total on results in any launch language", () => {
      for (const [locale, title] of [
        ["en", "Your search"],
        ["ar", "بحثك"],
        ["ckb", "گەڕانەکەت"],
      ] as const) {
        const { container, unmount } = render(
          <PublicCottageResults
            locale={locale}
            result={{
              status: "loaded",
              cottages: [{ ...cottage, amenities: ["pool", "wifi"] }],
              nextAfter: null,
            }}
            query={fullQuery}
            after={null}
            queryString=""
          />,
        );
        expect(screen.getByRole("region", { name: title })).toBeVisible();
        expect(screen.getByRole("article")).toBeVisible();
        expect(container).not.toHaveTextContent(/total/i);
        expect(container).not.toHaveTextContent("إجمالي");
        expect(container).not.toHaveTextContent("کۆی گشتی");
        unmount();
      }
    });

    it("renders a hostile governorate and area as text", () => {
      const hostile = '<img src=x onerror="alert(1)">';
      render(
        <PublicCottageResults
          locale="en"
          result={{ status: "loaded", cottages: [cottage], nextAfter: null }}
          query={{ ...query, governorate: hostile, area: hostile }}
          after={null}
          queryString=""
        />,
      );
      const summary = screen.getByRole("region", { name: "Your search" });
      expect(summary.querySelector("img")).toBeNull();
      const shown = within(summary).getAllByText(hostile);
      expect(shown).toHaveLength(2);
      for (const value of shown) expect(value.tagName).toBe("BDI");
      expect(summaryFacts("Your search").slice(3)).toEqual([
        ["Governorate", hostile],
        ["Approximate area", hostile],
      ]);
    });
  });

  describe("cottage links keep the results position", () => {
    it("a continued page's cottage links carry after", () => {
      render(
        <PublicCottageResults
          locale="en"
          result={{ status: "loaded", cottages: [cottage], nextAfter: null }}
          query={query}
          queryString="from=2026-09-22&to=2026-09-23&guests=4"
          after="cottage-0123456789abcdef0123456789abcdef"
        />,
      );
      expect(
        screen.getByRole("link", { name: "View cottage" }),
      ).toHaveAttribute(
        "href",
        "/en/cottages/garden-house?from=2026-09-22&to=2026-09-23&guests=4&after=cottage-0123456789abcdef0123456789abcdef",
      );
    });

    it("a first page's cottage links carry no after", () => {
      render(
        <PublicCottageResults
          locale="en"
          result={{ status: "loaded", cottages: [cottage], nextAfter: null }}
          query={query}
          queryString="from=2026-09-22&to=2026-09-23&guests=4"
          after={null}
        />,
      );
      const href = screen
        .getByRole("link", { name: "View cottage" })
        .getAttribute("href");
      expect(href).toBe(
        "/en/cottages/garden-house?from=2026-09-22&to=2026-09-23&guests=4",
      );
      expect(href).not.toContain("after=");
    });
  });
});
