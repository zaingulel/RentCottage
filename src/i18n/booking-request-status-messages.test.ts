import { describe, expect, it } from "vitest";

import { bookingRequestStatuses } from "@/booking-request/booking-request-status";
import { bookingRequestDeclineReasons } from "@/booking-request/booking-request-lifecycle";
import {
  bookingRequestDeclineReasonMessages,
  bookingRequestDisplayStatusMessages,
  bookingRequestStatusMessages,
  bookingRequestPaymentRequiredExpiryMessages,
} from "./booking-request-status-messages";

describe("Booking Request lifecycle copy", () => {
  it.each(["en", "ar", "ckb"] as const)(
    "maps every status and decline reason to %s user copy",
    (locale) => {
      for (const status of bookingRequestStatuses) {
        expect(bookingRequestStatusMessages[locale][status]).not.toBe(status);
      }
      for (const reason of bookingRequestDeclineReasons) {
        expect(bookingRequestDeclineReasonMessages[locale][reason]).not.toBe(
          reason,
        );
      }
    },
  );

  it.each([
    ["en", "Payment confirmation pending", "Booking confirmed"],
    ["ar", "بانتظار تأكيد الدفع", "تم تأكيد الحجز"],
    ["ckb", "چاوەڕێی پشتڕاستکردنەوەی پارەدان", "حجز پشتڕاست کراوەتەوە"],
  ] as const)(
    "distinguishes capture processing from paid confirmation in %s",
    (locale, captureProcessing, paidConfirmed) => {
      expect(
        bookingRequestDisplayStatusMessages[locale]["capture-processing"],
      ).toBe(captureProcessing);
      expect(
        bookingRequestDisplayStatusMessages[locale]["paid-confirmed"],
      ).toBe(paidConfirmed);
    },
  );
});

it.each([
  [
    "en",
    "Expired unpaid",
    "could not yet be verified",
    "remain held",
    "authorisations have been released",
  ],
  [
    "ar",
    "انتهى الطلب دون دفع",
    "لم نتمكن بعد من التحقق",
    "محجوزة",
    "تم تحرير تفويضات الدفع",
  ],
  [
    "ckb",
    "داواکارییەکە بەبێ پارەدان بەسەرچوو",
    "هێشتا نەمانتوانیوە",
    "گیراو دەمێننەوە",
    "مۆڵەتەکانی پارەدان ئازاد کراون",
  ],
] as const)(
  "distinguishes held uncertainty from safe unpaid expiry in %s",
  (locale, label, unresolved, held, released) => {
    const copy = bookingRequestPaymentRequiredExpiryMessages[locale];
    expect(copy.attention).toContain(unresolved);
    expect(copy.attention).toContain(held);
    expect(copy.attention).not.toContain(released);
    expect(copy.expiredLabel).toBe(label);
    expect(copy.expiredDescription).toContain(released);
    expect(copy.expiredDescription).not.toContain(held);
  },
);
