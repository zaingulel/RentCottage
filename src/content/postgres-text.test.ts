import { describe, expect, it } from "vitest";

import { btrim, charLength } from "./postgres-text";

describe("PostgreSQL text rules", () => {
  it("btrim strips only spaces and keeps newlines, tabs and no-break spaces", () => {
    expect(btrim("  \nx\t  ")).toBe("\nx\t");
    expect(btrim(" x")).toBe("x");
    expect(btrim("\u00A0x\u00A0 ")).toBe("\u00A0x\u00A0");
    expect(btrim("   ")).toBe("");
  });

  it("charLength counts code points, not UTF-16 units or graphemes", () => {
    expect(charLength("🏡".repeat(300))).toBe(300);
    expect(charLength("e\u0301")).toBe(2);
    expect(charLength("")).toBe(0);
  });
});
