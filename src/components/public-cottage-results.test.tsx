import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PublicCottageResults } from "./public-cottage-results";

const cottage = {
  slug: "garden-house",
  name: "Garden House",
  governorate: "Erbil",
  approximateLocation: "Shaqlawa",
  capacity: 5,
  amenities: ["pool"],
  mediaUrls: [],
  totalPriceIqd: 135000,
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
      available: true,
    },
  ],
};

describe("PublicCottageResults", () => {
  it("renders the price row, aligned shift rows and a button-styled action", () => {
    render(
      <PublicCottageResults
        locale="en"
        result={{ status: "loaded", cottages: [cottage] }}
        queryString="guests=4"
      />,
    );
    const card = screen.getByRole("article");
    expect(within(card).getByText("IQD 135,000").tagName).toBe("STRONG");
    expect(within(card).getByText("total")).toBeVisible();
    const rows = within(card).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Sep 22 · Shift 1 · 09:00–15:00");
    expect(within(rows[0]).getByText("IQD 60,000").tagName).toBe("B");
    expect(rows[1]).toHaveTextContent("Sep 23 · Full-day bundle · 09:00–23:00");
    expect(rows[1].querySelector("b")).toBeNull();
    const view = within(card).getByRole("link", { name: "View cottage" });
    expect(view).toHaveAttribute("href", "/en/cottages/garden-house?guests=4");
    expect(view).toHaveClass("action-link", "action-secondary", "action-full");
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it.each([
    ["ar", "22 أيلول", "الإجمالي"],
    ["ckb", "٢٢ی ئەیلوول", "کۆ"],
  ] as const)("formats Service Days and labels in %s", (locale, day, total) => {
    render(
      <PublicCottageResults
        locale={locale}
        result={{ status: "loaded", cottages: [cottage] }}
        queryString=""
      />,
    );
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent(day);
    expect(screen.getByText(total)).toBeVisible();
  });
});
