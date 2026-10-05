import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { messages } from "@/i18n/messages";
import { locales } from "@/i18n/routing";

import { NotFoundScreen } from "./not-found-screen";

describe("NotFoundScreen", () => {
  it.each(locales)(
    "shows the title, the detail and one home link in %s",
    (locale) => {
      render(<NotFoundScreen locale={locale} />);
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
        messages[locale].notFoundTitle,
      );
      expect(screen.getByText(messages[locale].notFoundDetail)).toBeVisible();
      const links = within(screen.getByRole("main")).getAllByRole("link");
      expect(links).toHaveLength(1);
      expect(links[0]).toHaveAttribute("href", `/${locale}`);
      expect(links[0]).toHaveAccessibleName(messages[locale].notFoundHome);
    },
  );

  it("translates the title differently in each language", () => {
    const titles = locales.map((locale) => messages[locale].notFoundTitle);
    expect(new Set(titles).size).toBe(locales.length);
  });
});
