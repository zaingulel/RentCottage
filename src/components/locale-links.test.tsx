import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LocaleLinks } from "./locale-links";

describe("LocaleLinks", () => {
  it.each([
    ["ar", "اللغة"],
    ["ckb", "زمان"],
    ["en", "Language"],
  ] as const)("uses the localized navigation name for %s", (locale, label) => {
    render(<LocaleLinks locale={locale} path="/results" queryString="" />);
    expect(screen.getByRole("navigation", { name: label })).toBeVisible();
  });
});
