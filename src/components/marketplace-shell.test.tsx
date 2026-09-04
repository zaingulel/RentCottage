import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { MarketplaceShell } from "./marketplace-shell";

describe("MarketplaceShell", () => {
  const facets = {
    status: "loaded" as const,
    governorates: ["Baghdad", "Erbil"],
    areas: ["Abu Ghraib", "Shaqlawa"],
    amenities: ["pool", "wifi"],
  };

  it("uses the selected Retreat prototype visual contract", () => {
    render(<MarketplaceShell initialLocale="en" facets={facets} />);

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
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Baghdad",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
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
    expect(screen.getByRole("link", { name: "Owner sign-in" })).toHaveAttribute(
      "href",
      "/en/owner/access",
    );
    expect(screen.queryByText("Visual direction")).not.toBeInTheDocument();
  });

  it("clears the missing-shift error once every Service Day is selected", async () => {
    const user = userEvent.setup();
    render(<MarketplaceShell initialLocale="en" facets={facets} />);

    fireEvent.change(screen.getByLabelText("From Service Day"), {
      target: { value: "2099-01-01" },
    });
    fireEvent.change(screen.getByLabelText("To Service Day"), {
      target: { value: "2099-01-01" },
    });
    await user.click(
      screen.getByRole("button", { name: "Search available cottages" }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Choose at least one shift for every Service Day.",
    );

    await user.click(screen.getByRole("checkbox", { name: "Shift 1" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("switches locale and direction without losing search state", async () => {
    window.history.replaceState({}, "", "/ar?arrival=2026-08-18#search");
    const user = userEvent.setup();
    render(<MarketplaceShell initialLocale="ar" facets={facets} />);

    await user.selectOptions(
      screen.getByLabelText("المحافظة (اختياري)"),
      "Baghdad",
    );
    await user.click(screen.getByRole("button", { name: "کوردی" }));

    expect(screen.getByLabelText("پارێزگا (ئارەزوومەندانە)")).toHaveValue(
      "Baghdad",
    );
    expect(window.location.pathname).toBe("/ckb");
    expect(window.location.search).toBe("?arrival=2026-08-18");
    expect(window.location.hash).toBe("#search");
    expect(document.documentElement).toHaveAttribute("lang", "ckb");
    expect(document.documentElement).toHaveAttribute("dir", "rtl");
    expect(screen.getByRole("navigation", { name: "زمان" })).toBeVisible();
    expect(
      screen.getByRole("link", { name: "چوونەژوورەوەی خاوەنی ماڵ" }),
    ).toHaveAttribute("href", "/ckb/owner/access");
    expect(screen.getByRole("checkbox", { name: "مەلەوانگە" })).toBeVisible();
    expect(screen.queryByText("Garden House")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "English" }));
    expect(document.documentElement).toHaveAttribute("dir", "ltr");
    expect(screen.getByLabelText("Governorate (optional)")).toHaveValue(
      "Baghdad",
    );
    expect(screen.getByRole("link", { name: "Owner sign-in" })).toHaveAttribute(
      "href",
      "/en/owner/access",
    );
  });
});
