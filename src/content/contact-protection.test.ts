import { describe, expect, it } from "vitest";

import { isContactProtectedTextSafe } from "./contact-protection";

describe("shared contact protection", () => {
  it.each([
    "+964 750 123 4567",
    "٠٧٥٠ ١٢٣ ٤٥٦٧",
    "۰۷۵۰-۱۲۳-۴۵۶۷",
    "zero seven five zero one two three four five six seven",
    "ava at example dot com",
    "ava@example.com",
    "name @ example . uk",
    "z a i n at g m a i l dot c o m",
    "example.dev",
    "https://example.com/ava",
    "@ava_hassan",
    "WhatsApp me",
  ])("rejects contact-bearing text: %s", (value) => {
    expect(isContactProtectedTextSafe(value)).toBe(false);
  });

  it.each([
    "Ava Hassan",
    "Please prepare garden seating for four people.",
    "One guest will arrive at the garden after seven.",
    "یەک میوان دوای حەوت دەگات.",
    "سنصل بعد سبع ساعات مع ضيف واحد.",
    "Room A7 has 4 chairs; garden B5 has 2 tables.",
  ])("allows ordinary marketplace text: %s", (value) => {
    expect(isContactProtectedTextSafe(value)).toBe(true);
  });
});
