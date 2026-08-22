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
    "name @ example . com",
    "name @ example . uk",
    "name at example dot uk",
    "z a i n at g m a i l dot c o m",
    "example.dev",
    "example dot dev",
    "0a7a5a0a1a2a3a4a5a6",
    "0a7b5c0d1e2f3g4h5i6",
    "0a 7b 5c 0d 1e 2f 3g 4h 5i 6",
    "٠a ٧b ٥c ٠d ١e ٢f ٣g ٤h ٥i ٦",
    "۰a ۷b ۵c ۰d ۱e ۲f ۳g ۴h ۵i ۶",
    "०७५०१२३४५६७",
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
    "Room A7 is beside garden B5.",
    "Room A7 is beside garden B5; 4 adults and 2 children.",
    "Room A7 has 4 chairs; garden B5 has 2 tables.",
    "Please use the polka-dot room beside the garden.",
  ])("allows ordinary booking-request content: %s", (value) => {
    expect(isContactSafeBookingRequestText(value)).toBe(true);
  });
});
