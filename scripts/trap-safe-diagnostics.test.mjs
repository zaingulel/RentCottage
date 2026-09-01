import { describe, expect, it } from "vitest";

import { capture, describeThrown } from "./lib/trap-safe-diagnostics.mjs";

describe("trap-safe diagnostics", () => {
  it.each([undefined, null, 0, false])(
    "preserves successful and thrown %# by identity",
    (value) => {
      expect(capture(() => value)).toEqual({ threw: false, value });
      expect(
        capture(() => {
          throw value;
        }),
      ).toEqual({ error: value, threw: true });
    },
  );

  it("uses a safely readable non-empty Error message", () => {
    expect(describeThrown(new Error("fixed ordinary failure"))).toBe(
      "fixed ordinary failure",
    );
  });

  it("falls back to safe string coercion for an empty Error message", () => {
    expect(describeThrown(new Error(""))).toBe("Error");
  });

  it("falls back to safe string coercion for a non-Error value", () => {
    expect(describeThrown("fixed string failure")).toBe("fixed string failure");
  });

  it.each([
    ["object without a primitive", Object.create(null)],
    [
      "prototype and coercion traps",
      new Proxy(
        {},
        {
          get() {
            throw new Error("fixed coercion trap");
          },
          getPrototypeOf() {
            throw new Error("fixed prototype trap");
          },
        },
      ),
    ],
    [
      "Error message and coercion traps",
      new Proxy(new Error("hidden"), {
        get() {
          throw new Error("fixed property trap");
        },
      }),
    ],
    [
      "string coercion trap",
      {
        [Symbol.toPrimitive]() {
          throw new Error("fixed primitive trap");
        },
      },
    ],
  ])("contains a hostile %s", (_, value) => {
    expect(() => describeThrown(value)).not.toThrow();
    expect(describeThrown(value)).toBe("<unprintable thrown value>");
  });
});
