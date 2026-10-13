import { expect, it } from "vitest";

import { messagingBookingStatusLabel } from "./messaging-booking-status";

it("selects authoritative messaging booking status labels", () => {
  const states = [
    [
      "confirmed",
      "paid-confirmed",
      "Confirmed booking",
      "حجز مؤكد",
      "حجزی پشتڕاستکراو",
    ],
    [
      "completed",
      "paid-confirmed",
      "Completed booking",
      "حجز مكتمل",
      "حجزی تەواوکراو",
    ],
    ["no_show", "paid-confirmed", "No-show", "عدم الحضور", "ئامادەنەبوون"],
    [
      "cancelled",
      "capture-processing",
      "Cancelled booking",
      "حجز ملغى",
      "حجزی هەڵوەشاوە",
    ],
    [
      "incident_pending",
      "paid-confirmed",
      "Incident pending",
      "واقعة قيد المتابعة",
      "ڕووداو چاوەڕێی بەدواداچوونە",
    ],
    [
      null,
      "payment-required",
      "Payment Required",
      "الدفع مطلوب",
      "پارەدان پێویستە",
    ],
    [null, null, "Pending", "قيد الانتظار", "چاوەڕێ"],
  ] as const;
  for (const [lifecycleStatus, paymentStatus, ...labels] of states) {
    const booking = {
      lifecycleStatus,
      paymentStatus,
      requestStatus: lifecycleStatus || paymentStatus ? "accepted" : "pending",
    } as const;
    for (const [index, locale] of (["en", "ar", "ckb"] as const).entries()) {
      expect(messagingBookingStatusLabel(locale, booking)).toBe(labels[index]);
    }
  }
});
