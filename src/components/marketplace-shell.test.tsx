import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { MarketplaceShell } from "./marketplace-shell";

describe("MarketplaceShell", () => {
  it("uses the selected Retreat prototype visual contract", () => {
    render(<MarketplaceShell initialLocale="en" />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "A house in the countryside, all yours",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("img", { name: "A rural house at sunset in Iraq" }),
    ).toHaveAttribute("src", "/uploads/hero-retreat.png");
    expect(screen.getByLabelText("Approximate area")).toBeVisible();
    expect(screen.getByLabelText("Preferred booking period")).toHaveValue(
      "full-day",
    );
    expect(screen.queryByText("Nights")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Find your retreat" }),
    ).toBeVisible();
    expect(screen.queryByText("Visual direction")).not.toBeInTheDocument();
  });

  it("switches locale and direction without losing search state", async () => {
    window.history.replaceState({}, "", "/ar?arrival=2026-08-18#search");
    const user = userEvent.setup();
    render(<MarketplaceShell initialLocale="ar" />);

    await user.selectOptions(screen.getByLabelText("الموقع التقريبي"), "north");
    await user.click(screen.getByRole("button", { name: "کوردی" }));

    expect(screen.getByLabelText("ناوچەی نزیکەوە")).toHaveValue("north");
    expect(window.location.pathname).toBe("/ckb");
    expect(window.location.search).toBe("?arrival=2026-08-18");
    expect(window.location.hash).toBe("#search");
    expect(document.documentElement).toHaveAttribute("lang", "ckb");
    expect(document.documentElement).toHaveAttribute("dir", "rtl");
    expect(screen.getByText("ماڵی باخچە")).toBeVisible();
    expect(screen.queryByText("Garden House")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "English" }));
    expect(document.documentElement).toHaveAttribute("dir", "ltr");
    expect(screen.getByLabelText("Approximate area")).toHaveValue("north");
  });
});
