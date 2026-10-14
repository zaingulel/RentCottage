import { describe, expect, it } from "vitest";

import {
  formatCount,
  formatFilsAsIqd,
  formatIqd,
  formatIraqDateTime,
  formatServiceDay,
} from "./format";

describe("localized formatting", () => {
  it("uses Western digits for Arabic prices to match property counts", () => {
    expect(formatIqd(180000, "en")).toBe("IQD 180,000");
    expect(formatIqd(180000, "ar")).toBe("IQD 180,000");
    expect(formatIqd(180000, "ckb")).not.toBe(formatIqd(180000, "en"));
  });

  it("preserves exact sub-IQD commission and net amounts", () => {
    expect(formatFilsAsIqd(10_000_300, "en")).toBe("IQD 10,000.3");
    expect(formatFilsAsIqd(90_002_700, "en")).toBe("IQD 90,002.7");
  });

  it("keeps every fils at the safe integer boundary", () => {
    expect(formatFilsAsIqd(Number.MAX_SAFE_INTEGER, "en")).toBe(
      "IQD 9,007,199,254,740.991",
    );
    expect(formatFilsAsIqd(1, "en")).toBe("IQD 0.001");
    expect(formatFilsAsIqd(-1, "en")).toBe("IQD -0.001");
    expect(() => formatFilsAsIqd(0.1, "en")).toThrow();
  });

  it.each([
    ["ar", "IQD 9,007,199,254,740.991", "IQD \u200e-0.001", "IQD 0.001"],
    ["ckb", "IQD ٩٬٠٠٧٬١٩٩٬٢٥٤٬٧٤٠٫٩٩١", "IQD \u200f-٠٫٠٠١", "IQD ٠٫٠٠١"],
  ] as const)(
    "preserves exact fractions, localized digits and negative direction marks in %s",
    (locale, largest, negative, positive) => {
      expect(formatFilsAsIqd(Number.MAX_SAFE_INTEGER, locale)).toBe(largest);
      expect(formatFilsAsIqd(-1, locale)).toBe(negative);
      expect(formatFilsAsIqd(1, locale)).toBe(positive);
    },
  );

  it("formats instants in Iraq local time with the shared locale mapping", () => {
    expect(formatIraqDateTime("2026-08-21T23:30:00Z", "en")).toBe(
      "Aug 22, 2026, 2:30 AM",
    );
    expect(formatIraqDateTime("2026-08-21T23:30:00Z", "ar")).toContain("2:30");
  });

  it("formats Service Days as calendar dates without a time zone shift", () => {
    expect(formatServiceDay("2026-09-22", "en")).toBe("Sep 22");
    expect(formatServiceDay("2026-09-22", "en", { weekday: true })).toBe(
      "Tue, Sep 22",
    );
    expect(formatServiceDay("2026-09-22", "ar")).toBe("22 أيلول");
    expect(formatServiceDay("2026-09-22", "ckb", { weekday: true })).toBe(
      "سێشەممە، ٢٢ی ئەیلوول",
    );
  });

  it("chooses the plural form and numerals each launch language uses for a count", () => {
    const arabic = {
      zero: "zero {count}",
      one: "one {count}",
      two: "two {count}",
      few: "few {count}",
      many: "many {count}",
      other: "other {count}",
    };
    expect(
      [0, 1, 2, 3, 11, 100].map((count) => formatCount(count, "ar", arabic)),
    ).toEqual(["zero 0", "one 1", "two 2", "few 3", "many 11", "other 100"]);
    expect(formatCount(2, "ckb", { other: "{count} items" })).toBe("٢ items");
    const english = { one: "{count} item", other: "{count} items" };
    expect(formatCount(1, "en", english)).toBe("1 item");
    expect(formatCount(2, "en", english)).toBe("2 items");
  });

  it("falls back to the other form when a language has no form for the category", () => {
    expect(formatCount(1, "ckb", { other: "{count} items" })).toBe("١ items");
    expect(
      formatCount(2, "ar", { one: "{count} item", other: "{count} items" }),
    ).toBe("2 items");
  });
});
