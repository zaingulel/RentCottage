import { describe, expect, it } from "vitest";

import { formatIqd } from "./format";

describe("localized formatting", () => {
  it("formats IQD numbers with the active locale", () => {
    expect(formatIqd(180000, "en")).toBe("IQD 180,000");
    expect(formatIqd(180000, "ar")).toBe("IQD ١٨٠٬٠٠٠");
    expect(formatIqd(180000, "ckb")).not.toBe(formatIqd(180000, "en"));
  });
});
