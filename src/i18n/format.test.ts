import { afterEach, describe, expect, it, vi } from "vitest";

import {
  formatCount,
  formatFilsAsIqd,
  formatInteger,
  formatIqd,
  formatIraqDateTime,
  formatServiceDay,
} from "./format";

type IntlLocales = string | readonly string[] | undefined;

function withoutSoraniData<
  Constructor extends new (...args: never[]) => object,
>(
  Real: Constructor & {
    supportedLocalesOf(locales: IntlLocales): string[];
  },
) {
  const substitute = (locales: IntlLocales) => {
    const first = Array.isArray(locales) ? locales[0] : locales;
    return typeof first === "string" && first.startsWith("ckb")
      ? "en-US"
      : locales;
  };
  const Wrapper = function (locales: IntlLocales, options?: object) {
    return new (Real as unknown as new (
      locales: IntlLocales,
      options?: object,
    ) => object)(substitute(locales), options);
  };
  Wrapper.supportedLocalesOf = (locales: IntlLocales) =>
    Real.supportedLocalesOf(substitute(locales));
  return Wrapper;
}

function stubRuntimeWithoutSoraniData() {
  const runtime = Object.create(Intl) as typeof Intl;
  Object.defineProperties(runtime, {
    NumberFormat: { value: withoutSoraniData(Intl.NumberFormat) },
    DateTimeFormat: { value: withoutSoraniData(Intl.DateTimeFormat) },
    PluralRules: { value: withoutSoraniData(Intl.PluralRules) },
  });
  vi.stubGlobal("Intl", runtime);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it("formats Sorani the same in a runtime without Sorani locale data", () => {
    stubRuntimeWithoutSoraniData();
    expect(new Intl.NumberFormat("ckb-IQ").format(180000)).toBe("180,000");

    expect(formatServiceDay("2026-09-22", "ckb", { weekday: true })).toBe(
      "سێشەممە، ٢٢ی ئەیلوول",
    );
    expect(formatServiceDay("2026-10-19", "ckb")).toBe("١٩ی تشرینی یەکەم");
    expect(formatIraqDateTime("2026-10-19T09:30:00Z", "ckb")).toBe(
      "٢٠٢٦ تشرینی یەکەم ١٩ ١٢:٣٠ د.ن",
    );
    expect(formatIraqDateTime("2026-01-05T21:05:00Z", "ckb")).toBe(
      "٢٠٢٦ کانوونی دووەم ٦ ١٢:٠٥ ب.ن",
    );
    expect(formatIqd(180000, "ckb")).toBe("IQD ١٨٠٬٠٠٠");
    expect(formatInteger(-5, "ckb")).toBe("\u200f-٥");
    const forms = { one: "one {count}", other: "other {count}" };
    expect(formatCount(1, "ckb", forms)).toBe("one ١");
    expect(formatCount(2, "ckb", forms)).toBe("other ٢");
    expect(formatFilsAsIqd(Number.MAX_SAFE_INTEGER, "ckb")).toBe(
      "IQD ٩٬٠٠٧٬١٩٩٬٢٥٤٬٧٤٠٫٩٩١",
    );
    expect(formatFilsAsIqd(-1, "ckb")).toBe("IQD \u200f-٠٫٠٠١");
    expect(formatFilsAsIqd(1, "ckb")).toBe("IQD ٠٫٠٠١");
  });

  it("matches Node's full Sorani locale data across dates, times, numbers and plural categories", () => {
    expect(Intl.DateTimeFormat.supportedLocalesOf(["ckb-IQ"])).toEqual([
      "ckb-IQ",
    ]);
    expect(Intl.NumberFormat.supportedLocalesOf(["ckb-IQ"])).toEqual([
      "ckb-IQ",
    ]);
    expect(Intl.PluralRules.supportedLocalesOf(["ckb-IQ"])).toEqual(["ckb-IQ"]);

    for (const year of [2026, 2028]) {
      const start = Date.UTC(year, 0, 1);
      const end = Date.UTC(year + 1, 0, 1);
      for (let time = start; time < end; time += 86_400_000) {
        const day = new Date(time);
        const serviceDay = day.toISOString().slice(0, 10);
        expect(formatServiceDay(serviceDay, "ckb")).toBe(
          new Intl.DateTimeFormat("ckb-IQ", {
            day: "numeric",
            month: "short",
            timeZone: "UTC",
          }).format(day),
        );
        expect(formatServiceDay(serviceDay, "ckb", { weekday: true })).toBe(
          new Intl.DateTimeFormat("ckb-IQ", {
            weekday: "short",
            day: "numeric",
            month: "short",
            timeZone: "UTC",
          }).format(day),
        );
      }
    }

    const baghdad = new Intl.DateTimeFormat("ckb-IQ", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Baghdad",
    });
    const instants: Date[] = [];
    for (
      let time = Date.UTC(2026, 9, 18);
      time <= Date.UTC(2026, 9, 20);
      time += 7 * 60_000
    ) {
      instants.push(new Date(time));
    }
    for (let month = 0; month < 12; month += 1) {
      instants.push(new Date(Date.UTC(2026, month, 1)));
    }
    instants.push(new Date("2026-12-31T21:00:00Z"));
    for (const instant of instants) {
      expect(formatIraqDateTime(instant.toISOString(), "ckb")).toBe(
        baghdad.format(instant),
      );
    }

    const integer = new Intl.NumberFormat("ckb-IQ", {
      maximumFractionDigits: 0,
    });
    for (const value of [
      0, 1, 9, 10, 999, 1000, 180000, 1234567, 9007199254740991, -1, -5,
      -180000,
    ]) {
      expect(formatInteger(value, "ckb")).toBe(integer.format(value));
      expect(formatIqd(value, "ckb")).toBe(`IQD ${integer.format(value)}`);
    }

    const forms = {
      zero: "zero {count}",
      one: "one {count}",
      two: "two {count}",
      few: "few {count}",
      many: "many {count}",
      other: "other {count}",
    };
    const plural = new Intl.PluralRules("ckb-IQ");
    for (let count = 0; count <= 200; count += 1) {
      expect(formatCount(count, "ckb", forms)).toBe(
        `${plural.select(count)} ${integer.format(count)}`,
      );
    }
  });
});
