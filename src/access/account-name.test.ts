import { describe, expect, it } from "vitest";

import { parseAccountName } from "./account-name";

describe("account first name rules", () => {
  it("accepts and trims a first name in English, Arabic and Sorani", () => {
    expect(parseAccountName("  Zana ")).toEqual({
      firstName: "Zana",
      initial: "Z",
    });
    expect(parseAccountName("زانا")).toEqual({
      firstName: "زانا",
      initial: "ز",
    });
    expect(parseAccountName("\tڕێبین\n")).toEqual({
      firstName: "ڕێبین",
      initial: "ڕ",
    });
    expect(parseAccountName("a".repeat(50))?.firstName).toBe("a".repeat(50));
    expect(parseAccountName("😀".repeat(49) + "Z")?.initial).toBe("Z");
  });

  it("refuses an empty, too long, letterless, control-character or contact-carrying first name", () => {
    const refused: unknown[] = [
      undefined,
      42,
      "",
      "   ",
      "a".repeat(51),
      "😀".repeat(50) + "Z",
      "123",
      "😀",
      "---",
      "Za\u0000na",
      "Za\nna",
      "Za\u007fna",
      "zana@example.com",
      "Zana 07701234567",
      "https://zana.example",
      "zana.com",
      "Zana WhatsApp",
    ];
    for (const value of refused) {
      expect(parseAccountName(value), String(value)).toBeUndefined();
    }
  });

  it.each([
    ["Zana", "Z"],
    ["zana", "Z"],
    ["زانا", "ز"],
    ["ڕێبین", "ڕ"],
    ["عَلي", "عَ"],
    ["😀Zana", "Z"],
    ["<img src=x onerror=alert(1)>", "I"],
  ])("takes the first letter grapheme of %s", (name, initial) => {
    expect(parseAccountName(name)?.initial).toBe(initial);
  });
});
