import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { MarketplaceShell } from "./marketplace-shell";

describe("MarketplaceShell", () => {
  afterEach(() => vi.useRealTimers());

  const facets = {
    status: "loaded" as const,
    governorates: ["Baghdad", "Erbil"],
    areas: ["Abu Ghraib", "Shaqlawa"],
    amenities: ["pool", "wifi"],
  };

  it("uses the selected Retreat prototype visual contract", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-21T20:59:59Z"));
    render(<MarketplaceShell locale="en" facets={facets} />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "A house in the countryside, all yours",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("img", { name: "A rural house at sunset in Iraq" }),
    ).toHaveAttribute("src", "/uploads/hero-retreat.png");
    expect(screen.getByLabelText("Governorate (optional)")).toHaveValue("");
    expect(screen.getByLabelText("From Service Day")).toHaveAttribute(
      "min",
      "2026-08-21",
    );
    expect(screen.getByLabelText("Approximate area (optional)")).toHaveValue(
      "",
    );
    expect(screen.getByRole("checkbox", { name: "Pool" })).toBeVisible();
    expect(
      screen.queryByRole("checkbox", { name: "Garden" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Nights")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Search available cottages" }),
    ).toBeVisible();
    expect(screen.queryByText("Visual direction")).not.toBeInTheDocument();
  });

  it("advances the minimum Service Day at Iraq midnight", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-21T21:00:00Z"));

    render(<MarketplaceShell locale="en" facets={facets} />);

    expect(screen.getByLabelText("From Service Day")).toHaveAttribute(
      "min",
      "2026-08-22",
    );
  });

  it("leaves the brand and language controls to the shared header", () => {
    render(<MarketplaceShell locale="ar" facets={facets} />);

    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "ريف كوتج" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "ابحث عن البيوت المتاحة" }),
    ).toBeVisible();
  });
});
