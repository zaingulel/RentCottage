import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PublicCottageProfileView } from "./public-cottage-profile";

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
      screen.getByRole("link", { name: "Back to results" }),
    ).toHaveAttribute("href", "/en/results?guests=4");
    expect(screen.queryByRole("navigation")).toBeNull();
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
