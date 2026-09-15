import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SiteFooter } from "./site-footer";

describe("SiteFooter", () => {
  it("links the discover, owner and language destinations for the current page", () => {
    const queryString =
      "from=2101-01-01&to=2101-01-01&guests=4&selection=2101-01-01%3Ashift%3A1";
    render(
      <SiteFooter locale="en" path="/results" queryString={queryString} />,
    );
    const discover = screen.getByRole("navigation", { name: "Discover" });
    expect(
      within(discover).getByRole("link", { name: "Search available cottages" }),
    ).toHaveAttribute("href", "/en");
    expect(
      within(discover).getByRole("link", { name: "My bookings" }),
    ).toHaveAttribute("href", "/en/bookings");
    expect(
      within(discover).getByRole("link", { name: "Messages" }),
    ).toHaveAttribute("href", "/en/messages");
    const owners = screen.getByRole("navigation", { name: "Owners" });
    expect(
      within(owners).getByRole("link", { name: "List your cottage" }),
    ).toHaveAttribute(
      "href",
      "/en/access?returnTo=%2Fen%2Fowner%2Fapplication",
    );
    expect(
      within(owners).getByRole("link", { name: "Owner application" }),
    ).toHaveAttribute("href", "/en/owner/application");
    expect(
      within(owners).getByRole("link", { name: "Sign in" }),
    ).toHaveAttribute(
      "href",
      `/en/access?returnTo=${encodeURIComponent(`/en/results?${queryString}`)}`,
    );
    expect(screen.getByRole("link", { name: "کوردی" })).toHaveAttribute(
      "href",
      `/ckb/results?${queryString}`,
    );
    expect(screen.getByRole("link", { name: "English" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.queryByRole("navigation", { name: "Language" })).toBeNull();
    expect(
      screen.getByText(`© ${new Date().getFullYear()} RentCottage`),
    ).toBeVisible();
    expect(screen.getByText("العربية · کوردی · English")).toBeVisible();
  });

  it.each([
    ["ar", "اكتشف", "المالكون", "اللغة", "ريف كوتج"],
    ["ckb", "بدۆزەرەوە", "خاوەنەکان", "زمان", "ڕێنت کۆتاج"],
  ] as const)(
    "localizes the footer headings and returns landing sign-in to bookings in %s",
    (locale, discover, owners, language, brand) => {
      render(<SiteFooter locale={locale} path="" queryString="" />);
      expect(screen.getByRole("navigation", { name: discover })).toBeVisible();
      expect(screen.getByRole("navigation", { name: owners })).toBeVisible();
      expect(screen.getByText(language)).toBeVisible();
      expect(
        screen.getByText(`© ${new Date().getFullYear()} ${brand}`),
      ).toBeVisible();
      expect(
        screen.getByRole("link", {
          name: locale === "ar" ? "تسجيل الدخول" : "چوونەژوورەوە",
        }),
      ).toHaveAttribute(
        "href",
        `/${locale}/access?returnTo=%2F${locale}%2Fbookings`,
      );
      expect(screen.getByRole("link", { name: "English" })).toHaveAttribute(
        "href",
        "/en",
      );
    },
  );
});
