import { describe, expect, it } from "vitest";

import { formatFilsAsIqd, formatIqd, formatIraqDateTime } from "./format";

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

  it("formats instants in Iraq local time with the shared locale mapping", () => {
    expect(formatIraqDateTime("2026-08-21T23:30:00Z", "en")).toBe(
      "Aug 22, 2026, 2:30 AM",
    );
    expect(formatIraqDateTime("2026-08-21T23:30:00Z", "ar")).toContain("2:30");
  });
});
