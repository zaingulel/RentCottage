import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LocaleLinks } from "./locale-links";

describe("LocaleLinks", () => {
  it.each([
    ["ar", "اللغة"],
    ["ckb", "زمان"],
    ["en", "Language"],
  ] as const)("uses the localized navigation name for %s", (locale, label) => {
    render(
      <LocaleLinks
        locale={locale}
        hrefFor={(target) => `/${target}/results`}
      />,
    );
    expect(screen.getByRole("navigation", { name: label })).toBeVisible();
  });

  it.each(["en", "ar", "ckb"] as const)(
    "lists English, Sorani Kurdish then Arabic and marks only the current language in %s",
    (locale) => {
      render(
        <LocaleLinks
          locale={locale}
          hrefFor={(target) => `/${target}/results`}
        />,
      );
      const links = screen.getAllByRole("link");
      expect(links.map((link) => link.textContent)).toEqual([
        "English",
        "کوردی",
        "العربية",
      ]);
      expect(links.map((link) => link.getAttribute("href"))).toEqual([
        "/en/results",
        "/ckb/results",
        "/ar/results",
      ]);
      const current = { en: 0, ckb: 1, ar: 2 }[locale];
      links.forEach((link, index) => {
        if (index === current) {
          expect(link).toHaveAttribute("aria-current", "page");
        } else {
          expect(link).not.toHaveAttribute("aria-current");
        }
      });
    },
  );
});
