import { describe, expect, it } from "vitest";

import { directionFor, locales, replaceLocaleInUrl } from "./routing";

describe("locale routing", () => {
  it("supports the three launch languages with native direction", () => {
    expect(locales).toEqual(["ar", "ckb", "en"]);
    expect(directionFor("ar")).toBe("rtl");
    expect(directionFor("ckb")).toBe("rtl");
    expect(directionFor("en")).toBe("ltr");
  });

  it("changes only the locale segment", () => {
    expect(
      replaceLocaleInUrl(
        "/ar/cottages/palm-house?arrival=2026-08-18#booking",
        "ckb",
      ),
    ).toBe("/ckb/cottages/palm-house?arrival=2026-08-18#booking");
  });
});
