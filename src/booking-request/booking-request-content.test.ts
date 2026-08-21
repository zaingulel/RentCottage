import { describe, expect, it } from "vitest";

import { isContactSafeBookingRequestText } from "./booking-request-content";

describe("Booking Request contact protection", () => {
  it.each([
    "+964 750 123 4567",
    "0750[123][4567]",
    "٠٧٥٠ ١٢٣ ٤٥٦٧",
    "٠٧٥٠[١٢٣][٤٥٦٧]",
    "۰۷۵۰-۱۲۳-۴۵۶۷",
    "۰۷۵۰—۱۲۳—۴۵۶۷",
    "٠٧٥٠–١٢٣–٤٥٦٧",
    "0750‑123‑4567",
    "0750​123​4567",
    "۰۷۵۰​۱۲۳​۴۵۶۷",
    "۰۷۵۰[۱۲۳][۴۵۶۷]",
    "zero seven five zero one two three four five six seven",
    "ava at example dot com",
    "صفر سبعة خمسة صفر واحد اثنان ثلاثة أربعة خمسة ستة سبعة",
    "ava ات example نقطة com",
    "سفر حەوت پێنج سفر یەک دوو سێ چوار پێنج شەش حەوت",
    "ava ئەت example دۆت com",
    "ava@example.com",
    "https://example.com/ava",
    "www.example.iq",
    "@ava_hassan",
    "contact:@ava_hassan",
    "telegram: ava-hassan",
    "WhatsApp me",
  ])("rejects contact details before owner disclosure: %s", (value) => {
    expect(isContactSafeBookingRequestText(value)).toBe(false);
  });

  it.each([
    "Ava Hassan",
    "Please prepare garden seating for four people.",
    "We will arrive after the evening shift begins.",
    "One guest will arrive at the garden after seven.",
    "یەک میوان دوای حەوت دەگات.",
    "سنصل بعد سبع ساعات مع ضيف واحد.",
  ])("allows ordinary booking-request content: %s", (value) => {
    expect(isContactSafeBookingRequestText(value)).toBe(true);
  });
});
